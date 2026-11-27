/* Recipe Collection — cloud sign-in and sync (Google Drive, or a local mock).
 *
 * Exposes window.RC:
 *   RC.onLocalSave()  call after the app writes recipes or the meal plan locally
 *   RC.syncNow()      run a pull + merge + push immediately
 *
 * The app stays local-first: localStorage remains the working copy, and the
 * "Recipe Collection" folder in the signed-in account is the shared source of
 * truth that every signed-in browser merges with. See README-cloud.md.
 */
(function () {
  'use strict';

  const SESSION_KEY = 'rc-cloud-session';
  const FP_KEY = 'rc-cloud-fingerprints';
  const TOMB_KEY = 'rc-cloud-tombstones';
  const PENDING_KEY = 'rc-cloud-oauth-pending';
  const RESULT_KEY = 'rc-cloud-oauth-result';
  const PLAN_KEY = 'recipe-weekly-plan-v1';
  const FOLDER_NAME = 'Recipe Collection';
  const RECIPES_FILE = 'recipes.json';
  const PLAN_FILE = 'plan.json';
  const IMG_DIR = 'img';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SCOPES = 'openid email profile ' + DRIVE_SCOPE;
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const PUSH_DELAY = 1200;

  const el = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- storage
  function readJSON(key, fallback, store) {
    try {
      const raw = (store || localStorage).getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value, store) {
    try {
      (store || localStorage).setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  function removeKey(key, store) {
    try { (store || localStorage).removeItem(key); } catch (e) { /* ignore */ }
  }

  // Bridge to the app's in-memory recipe list (defined in index.html).
  function app() { return window.RCApp || null; }
  function getRecipes() {
    const a = app();
    return a && Array.isArray(a.recipes) ? a.recipes : [];
  }
  function setRecipes(list) {
    const a = app();
    if (!a) return;
    try {
      localStorage.setItem(a.key, JSON.stringify(list));
    } catch (e) {
      throw new Error('This browser\'s storage is full, so the synced recipes could not be saved here. ' +
        'Remove some photos or recipes and sync again.');
    }
    a.recipes = list;
    try { a.render(); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- hashing
  // cyrb53: small, fast, good-enough 53-bit string hash for change detection.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  // Photos are large data URLs; sample them instead of hashing megabytes on every save.
  function imageSig(img) {
    if (typeof img !== 'string' || !img) return '';
    const n = img.length, mid = Math.floor(n / 2);
    return n.toString(36) + '-' + hash(img.slice(0, 512) + img.slice(mid - 256, mid + 256) + img.slice(-512));
  }
  function fingerprint(r) {
    return hash(JSON.stringify(r, (k, v) => (k === 'updatedAt' ? undefined : k === 'image' ? imageSig(v) : v)));
  }
  function ts(r) { return Number(r && (r.updatedAt || r.created)) || 0; }

  // Give every changed recipe an updatedAt and remember deletions, so merges
  // across devices know which copy is newer and don't resurrect deleted recipes.
  function stampChanges() {
    const list = getRecipes();
    const prev = readJSON(FP_KEY, null);
    const first = !prev || typeof prev !== 'object';
    const tombs = readJSON(TOMB_KEY, {}) || {};
    const now = Date.now();
    const next = {};
    let changed = false;
    for (const r of list) {
      if (!r || typeof r.id !== 'string') continue;
      const fp = fingerprint(r);
      next[r.id] = fp;
      if (first) {
        if (!r.updatedAt) { r.updatedAt = Number(r.created) || 0; changed = true; }
      } else if (prev[r.id] !== fp || !r.updatedAt) {
        r.updatedAt = Math.max(now, (Number(r.updatedAt) || 0) + 1);
        changed = true;
      }
      if (tombs[r.id] && tombs[r.id] < ts(r)) delete tombs[r.id];
    }
    if (!first) {
      for (const id of Object.keys(prev)) if (!(id in next)) tombs[id] = now;
    }
    if (changed) {
      const a = app();
      if (a) { try { localStorage.setItem(a.key, JSON.stringify(list)); } catch (e) { /* app reports quota */ } }
    }
    writeJSON(FP_KEY, next);
    writeJSON(TOMB_KEY, tombs);
  }
  function rememberFingerprints(list) {
    const fps = {};
    for (const r of list) if (r && typeof r.id === 'string') fps[r.id] = fingerprint(r);
    writeJSON(FP_KEY, fps);
  }

  // ---------------------------------------------------------------- encoding
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(n) {
    const a = new Uint8Array(n || 32);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(digest));
  }
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  async function blobToB64url(blob) {
    const d = await blobToDataURL(blob);
    return d.slice(d.indexOf(',') + 1).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function dataURLToBlob(d) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/.exec(d || '');
    if (!m) return null;
    const type = m[1] || 'application/octet-stream';
    if (m[3]) {
      const bin = atob(m[4]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(m[4])], { type });
  }
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  function imageExt(dataUrl) {
    const m = /^data:([^;,]+)/.exec(dataUrl || '');
    return (m && EXT[m[1].toLowerCase()]) || 'jpg';
  }

  // ---------------------------------------------------------------- state
  let config = null;
  let session = readJSON(SESSION_KEY, null);
  if (!session || typeof session !== 'object' || !session.provider) session = null;
  // A consented session starts syncing as soon as the config loads.
  let status = session ? (session.consented ? 'syncing' : 'consent') : 'signed-out';
  let generation = 0; // bumps on sign-in/out so stale syncs don't write
  let authWait = null;
  let syncTimer = 0, running = null, again = false;

  function saveSession() {
    if (session) writeJSON(SESSION_KEY, session); else removeKey(SESSION_KEY);
  }

  class ReconnectError extends Error {
    constructor() {
      super('Your Google sign-in has expired. Choose Reconnect to keep syncing.');
      this.reconnect = true;
    }
  }

  // ---------------------------------------------------------------- Google auth
  function googleConfig() { return config && config.google && config.google.client_id ? config.google : null; }

  async function tokenProxy(body) {
    const res = await fetch('/api/oauth/google/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let j = {};
    try { j = await res.json(); } catch (e) { /* fall through */ }
    if (!res.ok || !j.access_token) {
      const err = new Error(oauthErrorMessage(j.error || 'token_error', j.error_description || ''));
      err.code = j.error || '';
      throw err;
    }
    return j;
  }

  function oauthErrorMessage(code, description) {
    const d = String(description || '');
    if (code === 'access_denied') {
      return 'Google sign-in was cancelled or blocked (access_denied). If you didn\'t cancel, check that this ' +
        'Google account is listed as a test user on the OAuth consent screen.';
    }
    if (/client_secret/i.test(d)) {
      return 'Google needs the OAuth client secret to finish sign-in. Add google.client_secret to cloud-config.json ' +
        'on the server (see README-cloud.md) and try again.';
    }
    if (code === 'invalid_client' || code === 'unauthorized_client') {
      return 'Google rejected the client ID or secret in cloud-config.json (' + code + ').';
    }
    if (code === 'invalid_grant') return 'Google rejected the sign-in (invalid_grant). Please sign in again.';
    if (code === 'redirect_uri_mismatch') {
      return 'The redirect URI in cloud-config.json does not match the one registered with Google.';
    }
    if (code === 'no_code') return 'Google did not return a sign-in code. Please try again.';
    return 'Sign-in failed (' + code + (d ? ': ' + d : '') + ').';
  }

  // Must be called directly from a click: the pop-up is opened synchronously,
  // before any await, or browsers block it.
  function startGoogleSignIn(opts) {
    opts = opts || {};
    const g = googleConfig();
    if (!g) { setNote('Google sign-in is not configured yet.', true); return; }
    if (authWait) authWait.cancel(true);
    let popup = null;
    try {
      const w = 500, h = 640;
      const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2);
      const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2);
      popup = window.open('', 'rc-google-signin', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    } catch (e) { popup = null; }
    const mode = popup ? 'p' : 'r';
    const myGen = ++generation;
    setNote(popup ? 'Finish signing in in the Google window…' : 'Taking you to Google…');
    setBusy(true);
    (async () => {
      const useCode = !!g.token_proxy;
      const state = randomString(24) + '.' + mode;
      const verifier = useCode ? randomString(48) : '';
      const params = new URLSearchParams({
        client_id: g.client_id,
        redirect_uri: config.redirect_uri,
        response_type: useCode ? 'code' : 'token',
        scope: SCOPES,
        state,
        include_granted_scopes: 'true',
      });
      if (useCode) {
        params.set('code_challenge', await pkceChallenge(verifier));
        params.set('code_challenge_method', 'S256');
        params.set('access_type', 'offline');
      }
      if (opts.hint) params.set('login_hint', opts.hint);
      // Always let the person pick the account explicitly on a fresh sign-in;
      // consent is needed in code mode so Google issues a refresh token.
      const prompt = opts.hint ? (useCode ? 'consent' : '') : (useCode ? 'select_account consent' : 'select_account');
      if (prompt) params.set('prompt', prompt);
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
      const pending = { state, verifier, flow: useCode ? 'code' : 'token', hint: opts.hint || '', at: Date.now() };
      writeJSON(PENDING_KEY, pending, sessionStorage);
      removeKey(RESULT_KEY);
      if (!popup) { location.assign(url); return; }
      popup.location.href = url;
      const result = await waitForResult(state, popup);
      if (myGen !== generation) return;
      await finishGoogleSignIn(result, pending);
    })().catch((err) => {
      if (myGen !== generation) return;
      if (err && err.silent) return;
      setNote((err && err.message) || 'Sign-in failed.', true);
    }).finally(() => {
      if (myGen === generation) setBusy(false);
    });
  }

  function waitForResult(state, popup) {
    return new Promise((resolve, reject) => {
      let done = false, bc = null, poll = 0;
      const allowed = new Set([location.origin]);
      try { allowed.add(new URL(config.redirect_uri).origin); } catch (e) { /* ignore */ }
      function finish(p) {
        if (done || !p || p.type !== 'recipe-cloud-oauth' || p.state !== state) return;
        done = true; cleanup(); resolve(p);
      }
      function onMessage(e) { if (allowed.has(e.origin)) finish(e.data); }
      function onStorage(e) {
        if (e.key === RESULT_KEY && e.newValue) { try { finish(JSON.parse(e.newValue)); } catch (x) { /* ignore */ } }
      }
      function cleanup() {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('storage', onStorage);
        clearInterval(poll);
        try { if (bc) bc.close(); } catch (e) { /* ignore */ }
        removeKey(RESULT_KEY);
        if (authWait === handle) authWait = null;
      }
      const handle = {
        cancel(silent) {
          if (done) return;
          done = true; cleanup();
          const err = new Error('Sign-in cancelled.');
          err.silent = !!silent;
          reject(err);
        },
      };
      authWait = handle;
      window.addEventListener('message', onMessage);
      window.addEventListener('storage', onStorage);
      try { bc = new BroadcastChannel('rc-cloud-oauth'); bc.onmessage = (e) => finish(e.data); } catch (e) { bc = null; }
      // Google's pages can sever window.opener, which makes `popup.closed`
      // read true while the person is still signing in. So a closed pop-up
      // doesn't cancel the attempt; it only re-enables the button.
      poll = setInterval(() => {
        let closed = false;
        try { closed = popup.closed; } catch (e) { /* ignore */ }
        if (closed) {
          clearInterval(poll);
          setTimeout(() => {
            if (done) return;
            const stored = readJSON(RESULT_KEY, null);
            if (stored) { finish(stored); return; }
            setBusy(false);
            setNote('The Google window was closed. Choose Continue with Google to try again.');
          }, 1500);
        }
      }, 500);
    });
  }

  async function finishGoogleSignIn(result, pending) {
    removeKey(PENDING_KEY, sessionStorage);
    if (result.error) throw new Error(oauthErrorMessage(result.error, result.errorDescription));
    let token;
    if (pending.flow === 'code') {
      if (!result.code) throw new Error(oauthErrorMessage('no_code'));
      const j = await tokenProxy({ grant_type: 'authorization_code', code: result.code, code_verifier: pending.verifier });
      token = { access: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, refresh: j.refresh_token || '', scope: j.scope || result.scope || '' };
    } else {
      if (!result.accessToken) throw new Error(oauthErrorMessage('no_code'));
      token = { access: result.accessToken, expiresAt: Date.now() + (Number(result.expiresIn) || 3600) * 1000, refresh: '', scope: result.scope || '' };
    }
    if (token.scope && token.scope.split(/\s+/).indexOf(DRIVE_SCOPE) < 0) {
      throw new Error('Google Drive access wasn\'t granted, so recipes can\'t be saved to your account. ' +
        'Sign in again and tick the Google Drive permission on Google\'s consent screen.');
    }
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token.access } });
    if (!res.ok) throw new Error('Signed in, but Google did not return your account details (HTTP ' + res.status + ').');
    const info = await res.json();
    const user = { id: info.sub || '', name: info.name || info.given_name || info.email || 'Google user', email: info.email || '' };
    const sameAccount = session && session.provider === 'google' && session.user && session.user.id === user.id;
    if (sameAccount && !token.refresh && session.token && session.token.refresh) token.refresh = session.token.refresh;
    session = {
      provider: 'google',
      user,
      token,
      // A different account gets its own folder lookup and its own consent.
      folders: sameAccount ? (session.folders || {}) : {},
      consented: sameAccount ? !!session.consented : false,
      lastSync: sameAccount ? session.lastSync || 0 : 0,
      lastError: '',
    };
    saveSession();
    setNote('');
    afterSignIn();
  }

  function startMockSignIn() {
    if (!config || !config.mock) { setNote('Mock cloud is not enabled on this server.', true); return; }
    generation++;
    session = {
      provider: 'mock',
      user: { id: 'mock', name: 'Mock account', email: 'Stored on this server (~/.recipe-collection-cloud)' },
      token: null, folders: {}, consented: false, lastSync: 0, lastError: '',
    };
    saveSession();
    setNote('');
    afterSignIn();
  }

  function afterSignIn() {
    closeDialog('account-dialog');
    if (session.consented) { status = 'idle'; render(); syncNow(); }
    else showConsent();
  }

  async function accessToken(force) {
    if (!session || session.provider !== 'google' || !session.token) throw new ReconnectError();
    const t = session.token;
    if (!force && t.access && t.expiresAt - 60000 > Date.now()) return t.access;
    const g = googleConfig();
    if (t.refresh && g && g.token_proxy) {
      let j;
      try {
        j = await tokenProxy({ grant_type: 'refresh_token', refresh_token: t.refresh });
      } catch (e) {
        if (e.code === 'invalid_grant') { t.refresh = ''; saveSession(); throw new ReconnectError(); }
        throw e;
      }
      t.access = j.access_token;
      t.expiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000;
      if (j.refresh_token) t.refresh = j.refresh_token;
      saveSession();
      return t.access;
    }
    throw new ReconnectError();
  }

  function driveErrorMessage(statusCode, reason, message) {
    const text = (reason + ' ' + message).toLowerCase();
    if (/accessnotconfigured|has not been used|is disabled|service_disabled/.test(text)) {
      return 'The Google Drive API is not enabled for this Google Cloud project. Enable it under ' +
        'APIs & Services → Library → Google Drive API, then choose Sync now.';
    }
    if (/insufficient|scope/.test(text)) {
      return 'Google Drive access wasn\'t granted for this account. Sign out, sign in again, and tick the ' +
        'Google Drive permission on Google\'s consent screen.';
    }
    if (/storagequotaexceeded|quota/.test(text) && statusCode !== 429) {
      return 'Your Google Drive storage is full. Free up space, then choose Sync now.';
    }
    if (statusCode === 429 || /ratelimit/.test(text)) return 'Google Drive is rate-limiting requests. Sync will retry shortly.';
    return 'Google Drive error ' + statusCode + (message ? ': ' + message : '') + '.';
  }

  async function gfetch(url, opts, attempt) {
    opts = opts || {};
    attempt = attempt || 0;
    const token = await accessToken(attempt > 0 && opts._authRetry);
    let res;
    try {
      res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token }) }));
    } catch (e) {
      const err = new Error(navigator.onLine === false ? 'You\'re offline. Changes are saved here and will sync when you\'re back online.' : 'Could not reach Google Drive. Check your connection.');
      err.offline = true;
      throw err;
    }
    if (res.status === 401 && !opts._authRetry) {
      return gfetch(url, Object.assign({}, opts, { _authRetry: true }), attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
      return gfetch(url, opts, attempt + 1);
    }
    if (!res.ok) {
      let reason = '', message = '';
      try {
        const j = await res.json();
        message = (j.error && (j.error.message || j.error)) || '';
        reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) ||
          (j.error && j.error.status) || '';
        if (j.error && Array.isArray(j.error.details)) {
          for (const d of j.error.details) if (d && d.reason) reason += ' ' + d.reason;
        }
      } catch (e) { /* ignore */ }
      if (res.status === 401) throw new ReconnectError();
      const err = new Error(driveErrorMessage(res.status, String(reason), String(message)));
      err.status = res.status;
      throw err;
    }
    return res;
  }

  // ---------------------------------------------------------------- stores
  function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  class DriveStore {
    constructor() { this.ids = new Map(); }
    get folders() { return session.folders || (session.folders = {}); }
    async query(query) {
      const out = [];
      let pageToken = '';
      do {
        const p = new URLSearchParams({
          q: query, spaces: 'drive', pageSize: '1000', orderBy: 'modifiedTime desc',
          fields: 'nextPageToken,files(id,name,mimeType)',
        });
        if (pageToken) p.set('pageToken', pageToken);
        const j = await (await gfetch(DRIVE + '/files?' + p.toString())).json();
        out.push(...(j.files || []));
        pageToken = j.nextPageToken || '';
      } while (pageToken);
      return out;
    }
    async folder(name, parent) {
      const found = await this.query(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and '${q(parent)}' in parents and trashed=false`);
      if (found.length) return found[0].id;
      const res = await gfetch(DRIVE + '/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
      });
      return (await res.json()).id;
    }
    async ensure() {
      const f = this.folders;
      if (f.root) {
        try {
          const j = await (await gfetch(DRIVE + '/files/' + encodeURIComponent(f.root) + '?fields=id,trashed')).json();
          if (j.trashed) { f.root = ''; f.img = ''; }
        } catch (e) {
          if (e.status === 404) { f.root = ''; f.img = ''; } else throw e;
        }
      }
      if (!f.root) { f.root = await this.folder(FOLDER_NAME, 'root'); f.img = ''; }
      if (!f.img) f.img = await this.folder(IMG_DIR, f.root);
      saveSession();
    }
    async list() {
      const f = this.folders;
      const root = await this.query(`'${q(f.root)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`);
      const img = await this.query(`'${q(f.img)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`);
      this.ids.clear();
      for (const x of root) if (!this.ids.has(x.name)) this.ids.set(x.name, x.id);
      for (const x of img) { const n = IMG_DIR + '/' + x.name; if (!this.ids.has(n)) this.ids.set(n, x.id); }
      return [...this.ids.keys()];
    }
    async read(path) {
      const id = this.ids.get(path);
      if (!id) return null;
      try {
        return await (await gfetch(DRIVE + '/files/' + encodeURIComponent(id) + '?alt=media')).blob();
      } catch (e) {
        if (e.status === 404) { this.ids.delete(path); return null; }
        throw e;
      }
    }
    async write(path, blob) {
      const type = blob.type || 'application/octet-stream';
      const id = this.ids.get(path);
      if (id) {
        try {
          await gfetch(UPLOAD + '/files/' + encodeURIComponent(id) + '?uploadType=media&fields=id', {
            method: 'PATCH', headers: { 'Content-Type': type }, body: blob,
          });
          return;
        } catch (e) {
          if (e.status !== 404) throw e;
          this.ids.delete(path);
        }
      }
      const inImg = path.startsWith(IMG_DIR + '/');
      const meta = { name: inImg ? path.slice(IMG_DIR.length + 1) : path, parents: [inImg ? this.folders.img : this.folders.root], mimeType: type };
      const boundary = 'rc-' + randomString(16);
      const body = new Blob([
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
        '\r\n--' + boundary + '\r\nContent-Type: ' + type + '\r\n\r\n',
        blob,
        '\r\n--' + boundary + '--\r\n',
      ]);
      const res = await gfetch(UPLOAD + '/files?uploadType=multipart&fields=id', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
      });
      this.ids.set(path, (await res.json()).id);
    }
    async remove(path) {
      const id = this.ids.get(path);
      if (!id) return;
      try {
        // Trash rather than delete, so anything removed by mistake is recoverable in Drive.
        await gfetch(DRIVE + '/files/' + encodeURIComponent(id) + '?fields=id', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
        });
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      this.ids.delete(path);
    }
    link() { return this.folders.root ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(this.folders.root) : ''; }
  }

  class MockStore {
    async call(url, body) {
      let res;
      try {
        res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
      } catch (e) {
        const err = new Error('Could not reach the app server for mock sync.');
        err.offline = true;
        throw err;
      }
      return res;
    }
    async ensure() {}
    async list() {
      const res = await this.call('/api/mock-cloud/list');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || ('Mock cloud error ' + res.status + '.'));
      return (j.entries || []).map((e) => e.name);
    }
    async read(name) {
      const res = await this.call('/api/mock-cloud/read?name=' + encodeURIComponent(name));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Mock cloud error ' + res.status + '.');
      return res.blob();
    }
    async write(name, blob) {
      const res = await this.call('/api/mock-cloud/write', { name, contentBase64: await blobToB64url(blob) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || ('Mock cloud error ' + res.status + '.'));
      }
    }
    async remove(name) { await this.call('/api/mock-cloud/delete', { name }); }
    link() { return ''; }
  }

  let storeCache = null;
  function store() {
    const kind = session && session.provider;
    if (!storeCache || storeCache.kind !== kind) {
      storeCache = { kind, impl: kind === 'google' ? new DriveStore() : new MockStore() };
    }
    return storeCache.impl;
  }

  // ---------------------------------------------------------------- sync
  function parseRecipesDoc(text) {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : (j && Array.isArray(j.recipes) ? j.recipes : null);
    if (!list) throw new Error('not a recipe document');
    const deleted = {};
    if (j && j.deleted && typeof j.deleted === 'object') {
      for (const [id, t] of Object.entries(j.deleted)) if (Number(t) > 0) deleted[id] = Number(t);
    }
    return { recipes: list.filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string'), deleted };
  }
  function canonical(doc) {
    const recipes = doc.recipes.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const deleted = {};
    for (const k of Object.keys(doc.deleted).sort()) deleted[k] = doc.deleted[k];
    return JSON.stringify({ recipes, deleted });
  }

  function canSync() { return !!(session && session.consented && config && (session.provider !== 'mock' || config.mock)); }

  function scheduleSync(delay) {
    if (!canSync()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, delay == null ? PUSH_DELAY : delay);
  }

  function syncNow() {
    clearTimeout(syncTimer);
    if (!canSync()) return Promise.resolve();
    if (running) { again = true; return running; }
    const myGen = generation;
    running = (async () => {
      try {
        do {
          again = false;
          await syncOnce(myGen);
        } while (again && myGen === generation);
        if (myGen === generation) {
          session.lastSync = Date.now();
          session.lastError = '';
          saveSession();
          status = 'synced';
        }
      } catch (err) {
        if (myGen === generation && session) {
          session.lastError = (err && err.message) || 'Sync failed.';
          saveSession();
          status = err && err.reconnect ? 'reconnect' : err && err.offline ? 'offline' : 'error';
        }
      } finally {
        running = null;
        render();
      }
    })();
    return running;
  }

  async function syncOnce(myGen) {
    status = 'syncing';
    render();
    stampChanges();
    const s = store();
    await s.ensure();
    const names = new Set(await s.list());
    const stale = () => myGen !== generation;
    if (stale()) return;

    // ---- pull recipes
    let remote = { recipes: [], deleted: {} };
    if (names.has(RECIPES_FILE)) {
      const blob = await s.read(RECIPES_FILE);
      if (blob) {
        const text = await blob.text();
        try {
          remote = parseRecipesDoc(text);
        } catch (e) {
          // Keep the unreadable file instead of silently overwriting it.
          await s.write('recipes-unreadable-' + Date.now() + '.json', new Blob([text], { type: 'application/json' }));
        }
      }
    }

    // ---- merge (by id; newer updatedAt wins; deletions win over older edits)
    const local = getRecipes();
    const tombs = readJSON(TOMB_KEY, {}) || {};
    const deleted = Object.assign({}, remote.deleted);
    for (const [id, t] of Object.entries(tombs)) deleted[id] = Math.max(deleted[id] || 0, Number(t) || 0);
    const remoteById = new Map(remote.recipes.map((r) => [r.id, r]));
    const entries = new Map();
    for (const r of local) if (r && typeof r.id === 'string') entries.set(r.id, { local: r });
    for (const r of remote.recipes) { const e = entries.get(r.id) || {}; e.remote = r; entries.set(r.id, e); }

    const merged = [];
    const downloads = [];
    let localChanged = false;
    for (const [id, e] of entries) {
      let winner;
      if (e.local && (!e.remote || ts(e.local) >= ts(e.remote))) {
        winner = e.local;
      } else {
        winner = Object.assign({}, e.remote);
        delete winner.imageKey; delete winner.imageHash;
        const rm = e.remote;
        if (typeof rm.image === 'string' && rm.image.startsWith('data:')) {
          winner.image = rm.image;
        } else if (rm.imageKey) {
          if (e.local && e.local.image && imageSig(e.local.image) === rm.imageHash) winner.image = e.local.image;
          else { delete winner.image; downloads.push({ recipe: winner, key: rm.imageKey, fallback: e.local && e.local.image }); }
        } else {
          delete winner.image;
        }
        localChanged = true;
      }
      if ((deleted[id] || 0) >= ts(winner)) { if (e.local) localChanged = true; continue; }
      if (deleted[id]) delete deleted[id];
      merged.push(winner);
    }

    for (const d of downloads) {
      let blob = names.has(d.key) ? await s.read(d.key) : null;
      if (blob) {
        if (!blob.type || blob.type === 'application/octet-stream') {
          blob = new Blob([blob], { type: MIME[(d.key.split('.').pop() || '').toLowerCase()] || 'image/jpeg' });
        }
        d.recipe.image = await blobToDataURL(blob);
      } else if (d.fallback) {
        d.recipe.image = d.fallback;
      }
    }
    if (stale()) return;

    if (localChanged) {
      setRecipes(merged);
      window.dispatchEvent(new CustomEvent('rc:recipes-changed'));
    }
    rememberFingerprints(merged);
    writeJSON(TOMB_KEY, deleted);

    // ---- push images, then the recipe list that references them
    const wanted = new Set();
    const cloudRecipes = [];
    for (const r of merged) {
      const c = Object.assign({}, r);
      delete c.image;
      if (typeof r.image === 'string' && r.image.startsWith('data:')) {
        const key = IMG_DIR + '/' + r.id + '.' + imageExt(r.image);
        const sig = imageSig(r.image);
        const prev = remoteById.get(r.id);
        if (!names.has(key) || !prev || prev.imageKey !== key || prev.imageHash !== sig) {
          const blob = dataURLToBlob(r.image);
          if (blob) { await s.write(key, blob); names.add(key); }
        }
        c.imageKey = key;
        c.imageHash = sig;
        wanted.add(key);
      }
      cloudRecipes.push(c);
    }
    if (stale()) return;
    const doc = { recipes: cloudRecipes, deleted };
    if (!names.has(RECIPES_FILE) || canonical(doc) !== canonical(remote)) {
      const sorted = JSON.parse(canonical(doc));
      const body = JSON.stringify({ app: 'recipe-collection', version: 1, savedAt: new Date().toISOString(), recipes: sorted.recipes, deleted: sorted.deleted }, null, 1);
      await s.write(RECIPES_FILE, new Blob([body], { type: 'application/json' }));
    }
    for (const name of names) {
      if (name.startsWith(IMG_DIR + '/') && !wanted.has(name)) await s.remove(name);
    }

    // ---- meal plan: whole document, newer updatedAt wins
    if (stale()) return;
    const localPlan = readJSON(PLAN_KEY, null);
    let remotePlan = null;
    if (names.has(PLAN_FILE)) {
      const blob = await s.read(PLAN_FILE);
      if (blob) { try { remotePlan = JSON.parse(await blob.text()); } catch (e) { remotePlan = null; } }
    }
    const lt = Number(localPlan && localPlan.updatedAt) || 0;
    const rt = Number(remotePlan && remotePlan.updatedAt) || 0;
    if (remotePlan && typeof remotePlan === 'object' && (!localPlan || rt > lt)) {
      if (stale()) return;
      writeJSON(PLAN_KEY, remotePlan);
      window.dispatchEvent(new CustomEvent('rc:plan-changed'));
    } else if (localPlan && typeof localPlan === 'object' && JSON.stringify(localPlan) !== JSON.stringify(remotePlan)) {
      await s.write(PLAN_FILE, new Blob([JSON.stringify(localPlan)], { type: 'application/json' }));
    }
    if (localChanged) window.dispatchEvent(new CustomEvent('rc:plan-changed'));
  }

  // ---------------------------------------------------------------- UI
  let noteIsHint = false;
  function setNote(text, isError, hint) {
    const n = el('provider-note');
    if (!n) return;
    noteIsHint = !!hint;
    n.textContent = text || '';
    n.classList.toggle('is-error', !!isError);
  }
  function setBusy(busy) {
    const g = el('signin-google');
    if (g) g.disabled = !!busy || !googleConfig();
    const m = el('signin-mock');
    if (m) m.disabled = !!busy;
  }
  function openDialog(id) { const d = el(id); if (d && !d.open) d.showModal(); }
  function closeDialog(id) { const d = el(id); if (d && d.open) d.close(); }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function when(t) {
    if (!t) return 'Not yet';
    const d = new Date(t), now = new Date();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? 'Today at ' + time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
  }

  const STATUS_TEXT = {
    'signed-out': 'Sign in to sync',
    consent: 'Finish setup',
    idle: 'Sync',
    syncing: 'Syncing…',
    synced: 'Synced',
    error: 'Sync error',
    offline: 'Offline',
    reconnect: 'Reconnect',
  };

  const SHORT_TEXT = {
    'signed-out': 'Sync', consent: 'Set up', idle: 'Sync', syncing: 'Syncing', synced: 'Synced',
    error: 'Error', offline: 'Offline', reconnect: 'Reconnect',
  };

  function render() {
    if (!session) status = 'signed-out';
    else if (!session.consented) status = 'consent';
    const btn = el('account-open');
    if (btn) {
      const available = !!config;
      btn.hidden = !available;
      const dot = btn.querySelector('.account-dot');
      dot.className = 'account-dot' + ({ synced: ' on', syncing: ' syncing', error: ' error', reconnect: ' error' }[status] || '');
      btn.querySelector('.account-label').textContent = STATUS_TEXT[status] || 'Sync';
      btn.querySelector('.account-short').textContent = SHORT_TEXT[status] || 'Sync';
      btn.setAttribute('aria-label', (STATUS_TEXT[status] || 'Sync') + (session && session.user && session.user.email ? ' — ' + session.user.email : ''));
      btn.classList.toggle('is-error', status === 'error' || status === 'reconnect');
      btn.title = session
        ? (session.provider === 'google' ? 'Signed in as ' + (session.user.email || session.user.name) : 'Mock cloud') +
          (session.lastSync ? ' · last synced ' + when(session.lastSync) : '')
        : 'Sign in to save your recipes to Google Drive';
    }

    // Account dialog
    const out = el('acct-out'), inn = el('acct-in');
    if (!out || !inn) return;
    out.hidden = !!session && !!session.consented;
    inn.hidden = !out.hidden;
    el('account-title').textContent = out.hidden ? 'Cloud sync' : 'Sync your recipes';
    const g = googleConfig();
    const gBtn = el('signin-google');
    gBtn.disabled = !g || !!authWait;
    el('signin-google-label').textContent = g ? 'Continue with Google' : 'Google — not configured yet';
    el('signin-mock').hidden = !(config && config.mock);
    // Configuration hint: derived from the loaded config, never sticky.
    if (config && !g && (noteIsHint || !el('provider-note').textContent)) {
      setNote('Google sign-in isn\'t set up on this server yet. Add a client ID to cloud-config.json (see README-cloud.md).', false, true);
    } else if (g && noteIsHint) {
      setNote('');
    }
    if (inn.hidden) return;
    const u = session.user || {};
    el('acct-avatar').textContent = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    el('acct-name').textContent = u.name || 'Signed in';
    el('acct-email').textContent = u.email || '';
    el('acct-status').textContent = {
      syncing: 'Syncing…', synced: 'Up to date', idle: 'Ready', error: 'Not syncing — see the problem below',
      offline: 'Offline — changes are kept on this device', reconnect: 'Sign-in expired',
    }[status] || '';
    const where = el('acct-where');
    where.replaceChildren();
    const link = store().link();
    if (session.provider === 'google' && link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'Google Drive › ' + FOLDER_NAME + ' ↗';
      where.append(a);
    } else {
      where.textContent = session.provider === 'google' ? 'Google Drive › ' + FOLDER_NAME : 'Mock cloud folder on the app server';
    }
    el('acct-last').textContent = when(session.lastSync);
    const err = session.lastError && (status === 'error' || status === 'reconnect' || status === 'offline') ? session.lastError : '';
    el('acct-error').textContent = err;
    el('acct-error').hidden = !err;
    el('acct-error-label').hidden = !err;
    const syncBtn = el('acct-sync');
    syncBtn.textContent = status === 'reconnect' ? 'Reconnect' : status === 'syncing' ? 'Syncing…' : 'Sync now';
    syncBtn.disabled = status === 'syncing';
  }

  function showConsent() {
    if (!session) return;
    const google = session.provider === 'google';
    const count = getRecipes().length;
    el('consent-title').textContent = google ? 'Save your recipes to Google Drive?' : 'Save your recipes to the mock cloud?';
    el('consent-account').textContent = google ? (session.user.email || session.user.name) : 'Mock account (this server)';
    el('consent-where').textContent = google ? 'this account\'s Google Drive' : 'a test folder on the app server';
    el('consent-count').textContent = count ? 'your ' + plural(count, 'recipe') : 'your recipes';
    el('consent-scope').hidden = !google;
    el('consent-switch').hidden = !google;
    status = 'consent';
    render();
    openDialog('consent-dialog');
    el('consent-allow').focus();
  }

  function signOut(note) {
    generation++;
    clearTimeout(syncTimer);
    if (authWait) authWait.cancel(true);
    session = null;
    storeCache = null;
    saveSession();
    status = 'signed-out';
    setBusy(false);
    setNote(note || '');
    render();
  }

  function bindUI() {
    const btn = el('account-open');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (session && !session.consented) { showConsent(); return; }
      render();
      openDialog('account-dialog');
    });
    el('signin-google').addEventListener('click', () => startGoogleSignIn());
    el('signin-mock').addEventListener('click', startMockSignIn);
    el('acct-signout').addEventListener('click', () => {
      signOut('Signed out. Your recipes are still saved in this browser.');
    });
    el('acct-sync').addEventListener('click', () => {
      if (status === 'reconnect' && session && session.provider === 'google') {
        startGoogleSignIn({ hint: session.user.email });
        return;
      }
      syncNow();
    });
    el('consent-allow').addEventListener('click', () => {
      if (!session) return;
      session.consented = true;
      saveSession();
      closeDialog('consent-dialog');
      status = 'idle';
      render();
      syncNow();
    });
    el('consent-deny').addEventListener('click', () => {
      signOut('Not now — your recipes stay in this browser only.');
      closeDialog('consent-dialog');
    });
    el('consent-switch').addEventListener('click', () => {
      closeDialog('consent-dialog');
      signOut();
      openDialog('account-dialog');
      startGoogleSignIn();
    });
    // Closing the prompt any way other than Allow (Not now, Esc) keeps everything local.
    el('consent-dialog').addEventListener('close', () => {
      if (session && !session.consented) signOut('Not now — your recipes stay in this browser only.');
    });
    el('account-dialog').addEventListener('close', () => {
      if (!session && !authWait) setNote('');
    });
  }

  // Full-page redirect fallback: finish sign-in after coming back from Google.
  function resumeRedirectSignIn() {
    const params = new URLSearchParams(location.search);
    const result = readJSON(RESULT_KEY, null, sessionStorage);
    if (!params.has('rc_oauth') && !result) return false;
    removeKey(RESULT_KEY, sessionStorage);
    if (params.has('rc_oauth')) {
      params.delete('rc_oauth');
      const qs = params.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* ignore */ }
    }
    const pending = readJSON(PENDING_KEY, null, sessionStorage);
    if (!result || !pending || result.state !== pending.state) return false;
    const myGen = ++generation;
    openDialog('account-dialog');
    setNote('Finishing sign-in…');
    setBusy(true);
    finishGoogleSignIn(result, pending).catch((err) => {
      if (myGen === generation) setNote((err && err.message) || 'Sign-in failed.', true);
    }).finally(() => { if (myGen === generation) setBusy(false); });
    return true;
  }

  // ---------------------------------------------------------------- public API
  window.RC = {
    onLocalSave() {
      try { stampChanges(); } catch (e) { /* never break local saves */ }
      scheduleSync();
    },
    syncNow,
    get status() { return status; },
  };

  function init() {
    bindUI();
    try { stampChanges(); } catch (e) { /* ignore */ }
    render();
    fetch('/api/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((c) => {
        config = c && typeof c === 'object' ? c : null;
        render();
        if (!config) return;
        if (resumeRedirectSignIn()) return;
        if (!session) return;
        if (!session.consented) { showConsent(); return; }
        if (session.provider === 'mock' && !config.mock) {
          session.lastError = 'Mock cloud is turned off in cloud-config.json. Sign out and sign in with Google.';
          status = 'error';
          saveSession();
          render();
          return;
        }
        syncNow();
      });
    window.addEventListener('online', () => scheduleSync(0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && session && session.consented && Date.now() - (session.lastSync || 0) > 30000) scheduleSync(0);
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && session && session.consented && !running && Date.now() - (session.lastSync || 0) > 5 * 60000) syncNow();
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
