// Recipe Collection: optional sync through each person's own Google Drive.
//
// How it works
// - Sign-in uses Google Identity Services in the browser. There is no server and no client secret.
// - Recipes are stored in one JSON file in the Drive "appDataFolder": a hidden folder that only this
//   app can read. The app cannot see any of the person's other Drive files.
// - Each recipe carries an `updated` time. Merging keeps the newest copy of each recipe and
//   remembers deletions, so a recipe deleted on one device is removed everywhere.
// - Google access tokens last about an hour and only allow access to that hidden folder. The token
//   is kept in this browser until it expires (or the person stops syncing), so reloads and new tabs
//   keep syncing; after it expires, sync pauses until the person taps "Resume sync".
(() => {
  'use strict';

  const config = window.RECIPE_CONFIG || {};
  const CLIENT_ID = String(config.googleClientId || '').trim();
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const SCOPES = DRIVE_SCOPE + ' email';
  const FILE_NAME = 'recipe-collection.json';
  const FORMAT = 'recipe-collection-sync';
  const STATE_KEY = 'recipe-collection-sync';
  const DELETED_KEY = 'recipe-collection-deleted';
  const TOKEN_KEY = 'recipe-collection-sync-token';
  const REDIRECT_KEY = 'recipe-collection-sync-redirect';
  const DELETED_KEEP_MS = 400 * 24 * 60 * 60 * 1000;
  const DRIVE = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  const $ = s => document.querySelector(s);

  function readJSON(store, key, fallback) {
    try { const v = JSON.parse(store.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }
  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch {}
  }

  // ---------- Merge (pure; also used by tests) ----------

  function stampOf(r) { return Number(r && (r.updated || r.created)) || 0; }
  function sameRecipeKey(r) {
    return String(r.name || '').trim().toLowerCase() + '|' +
      String(r.ingredients || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function cleanDeleted(map, now) {
    const out = {};
    for (const [id, t] of Object.entries(map || {})) {
      const n = Number(t);
      if (id && n && now - n < DELETED_KEEP_MS) out[id] = n;
    }
    return out;
  }

  // local/remote: {recipes: [...], deleted: {id: time}}
  // firstSync: this device has never synced, so recipes that already exist in Drive under a
  // different id (for example, both devices imported the same backup) are matched by
  // name + ingredients instead of being duplicated.
  function merge(local, remote, { firstSync = false, now = Date.now() } = {}) {
    const deleted = cleanDeleted(remote && remote.deleted, now);
    for (const [id, t] of Object.entries(cleanDeleted(local && local.deleted, now))) {
      if (!(deleted[id] >= t)) deleted[id] = t;
    }
    const remoteList = (remote && Array.isArray(remote.recipes) ? remote.recipes : [])
      .filter(r => r && typeof r === 'object' && typeof r.id === 'string');
    const localList = (local && Array.isArray(local.recipes) ? local.recipes : [])
      .filter(r => r && typeof r === 'object' && typeof r.id === 'string');

    const chosen = new Map(remoteList.map(r => [r.id, r]));
    const twins = firstSync ? new Map(remoteList.map(r => [sameRecipeKey(r), r])) : null;
    const order = [];
    for (const r of localList) {
      let id = r.id;
      let other = chosen.get(id);
      if (!other && twins && twins.has(sameRecipeKey(r))) {
        other = twins.get(sameRecipeKey(r));
        id = other.id;
        const kept = stampOf(r) > stampOf(other) ? { ...r, id } : { ...other };
        if (!kept.rating && (r.rating || other.rating)) kept.rating = r.rating || other.rating;
        if (!kept.image && (r.image || other.image)) kept.image = r.image || other.image;
        chosen.set(id, kept);
      } else if (!other || stampOf(r) >= stampOf(other)) {
        chosen.set(id, r);
      }
      if (!order.includes(id)) order.push(id);
    }
    for (const r of remoteList) if (!order.includes(r.id)) order.push(r.id);
    const recipes = order.map(id => chosen.get(id)).filter(r => !(deleted[r.id] >= stampOf(r)));
    return { recipes, deleted };
  }

  // ---------- Local state ----------

  let state = readJSON(localStorage, STATE_KEY, {});
  if (!state || typeof state !== 'object') state = {};
  function saveState() { writeJSON(localStorage, STATE_KEY, state); }
  function readDeleted() { return readJSON(localStorage, DELETED_KEY, {}); }
  function writeDeleted(map) { writeJSON(localStorage, DELETED_KEY, map); }

  function noteDeleted(ids, time) {
    const map = readDeleted();
    for (const id of ids) map[id] = time;
    writeDeleted(cleanDeleted(map, Date.now()));
  }

  let token = null;
  let tokenExpires = 0;
  const saved = readJSON(localStorage, TOKEN_KEY, null);
  if (state.connected && saved && saved.token && saved.expires > Date.now()) {
    token = saved.token; tokenExpires = saved.expires;
  }
  function hasToken() { return !!token && Date.now() < tokenExpires; }
  function dropToken() {
    token = null; tokenExpires = 0;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  // ---------- Status display ----------

  let status = 'off';
  let statusMessage = '';
  let pending = false;

  function timeLabel(t) {
    if (!t) return '';
    const d = new Date(t);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function setStatus(next, message = '') {
    status = next; statusMessage = message; paint();
  }

  function paint() {
    const button = $('#sync-open');
    if (!button) return;
    if (!CLIENT_ID) { button.hidden = true; return; }
    button.hidden = false;
    const labels = {
      off: 'Sync', syncing: 'Syncing…', synced: 'Synced', paused: 'Resume sync', error: 'Sync problem'
    };
    let kind = state.connected ? status : 'off';
    if (kind === 'synced' && pending) kind = 'syncing';
    button.querySelector('.sync-label').textContent = labels[kind] || 'Sync';
    button.dataset.state = kind;
    button.title = kind === 'synced' && state.lastSync ? 'Last synced ' + timeLabel(state.lastSync) : '';

    const dialog = $('#sync-dialog');
    if (!dialog) return;
    $('#sync-off').hidden = !!state.connected;
    $('#sync-on').hidden = !state.connected;
    $('#sync-email').textContent = state.email || 'your Google account';
    $('#sync-last').textContent = state.lastSync ? 'Last synced ' + timeLabel(state.lastSync) + '.' : 'Not synced yet.';
    $('#sync-stop').hidden = !state.connected;
    $('#sync-forget').hidden = !state.connected;
    const go = $('#sync-go');
    go.textContent = !state.connected ? 'Sign in with Google' : hasToken() ? 'Sync now' : 'Resume sync';
    const waitingForGoogle = !hasToken() && !googleReady() && googleLoad !== 'failed';
    go.disabled = status === 'syncing' || waitingForGoogle;
    if (waitingForGoogle && !state.connected) go.textContent = 'Loading Google sign-in…';
    $('#sync-redirect').hidden = !offerRedirect || hasToken();
    let line = statusMessage;
    if (!line && state.connected && !hasToken()) {
      line = pending
        ? 'You have changes waiting. Select Resume sync to sign in again and send them.'
        : 'Google sign-in expires after about an hour. Select Resume sync to continue.';
    }
    $('#sync-status').textContent = line;
    $('#sync-status').classList.toggle('sync-error', status === 'error');
  }

  // ---------- Google sign-in ----------

  let gisPromise = null;
  let googleLoad = 'idle'; // idle | loading | ready | failed
  let offerRedirect = false;
  function googleReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function loadGoogle() {
    if (googleReady()) { googleLoad = 'ready'; return Promise.resolve(); }
    if (!gisPromise) {
      googleLoad = 'loading';
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => { googleLoad = 'ready'; paint(); resolve(); };
        s.onerror = () => {
          gisPromise = null; googleLoad = 'failed'; offerRedirect = true; s.remove(); paint();
          reject(Error('Could not load Google sign-in. Check your connection, or select Sign in on this page instead.'));
        };
        document.head.append(s);
      });
    }
    return gisPromise;
  }

  // Same-tab sign-in: used when the browser blocks Google's sign-in window.
  // Google sends the person back here with a short-lived token in the address (#access_token=…).
  function appAddress() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function signInWithRedirect() {
    const nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)) + Date.now();
    writeJSON(sessionStorage, REDIRECT_KEY, { state: nonce, started: Date.now() });
    const params = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: appAddress(), response_type: 'token',
      scope: SCOPES, state: nonce, include_granted_scopes: 'true'
    });
    if (!state.connected) params.set('prompt', 'consent');
    if (state.email) params.set('login_hint', state.email);
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params);
  }
  function takeRedirectResult() {
    if (!/[#&](state|access_token|error)=/.test(location.hash)) return null;
    const back = new URLSearchParams(location.hash.slice(1));
    const saved = readJSON(sessionStorage, REDIRECT_KEY, null);
    if (!saved || !back.get('state') || back.get('state') !== saved.state || Date.now() - saved.started > 15 * 60000) return null;
    try { sessionStorage.removeItem(REDIRECT_KEY); } catch {}
    history.replaceState(null, '', location.pathname + location.search);
    const error = back.get('error');
    if (error) return { error: error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in did not finish (' + error + ').' };
    if (!(back.get('scope') || '').split(' ').includes(DRIVE_SCOPE)) {
      return { error: 'Sync needs permission to use its private Google Drive folder. Try again and leave that box checked.' };
    }
    if (!back.get('access_token')) return { error: 'Google sign-in did not finish.' };
    token = back.get('access_token');
    tokenExpires = Date.now() + (Number(back.get('expires_in')) || 3600) * 1000 - 60000;
    writeJSON(localStorage, TOKEN_KEY, { token, expires: tokenExpires });
    return { ok: true };
  }

  function signIn() {
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: response => {
          if (response.error) {
            reject(Error(response.error === 'access_denied'
              ? 'Google sign-in was cancelled.'
              : 'Google sign-in did not finish (' + response.error + ').'));
            return;
          }
          if (!google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
            reject(Error('Sync needs permission to use its private Google Drive folder. Try again and leave that box checked.'));
            return;
          }
          token = response.access_token;
          tokenExpires = Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60000;
          writeJSON(localStorage, TOKEN_KEY, { token, expires: tokenExpires });
          resolve();
        },
        error_callback: err => {
          const type = err && err.type;
          if (type === 'popup_failed_to_open') offerRedirect = true;
          reject(Error(type === 'popup_failed_to_open'
            ? 'Your browser blocked the Google sign-in window. Select Sign in on this page instead, or allow pop-ups for this site.'
            : type === 'popup_closed'
              ? 'The Google sign-in window was closed before sign-in finished.'
              : 'Google sign-in did not finish.'));
        }
      });
      const options = { prompt: state.connected ? '' : 'consent' };
      if (state.email) options.login_hint = state.email;
      client.requestAccessToken(options);
    });
  }

  // ---------- Google Drive ----------

  class AuthError extends Error {}

  async function api(url, options = {}) {
    if (!hasToken()) throw new AuthError('Sign-in expired.');
    let response;
    try {
      response = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    } catch {
      throw Error('Could not reach Google Drive. Check your connection; your recipes are still saved on this device.');
    }
    if (response.status === 401) { dropToken(); throw new AuthError('Sign-in expired.'); }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error.message || ''; } catch {}
      if (response.status === 403 && /storage|quota/i.test(detail)) throw Error('Your Google Drive is full, so recipes could not be synced.');
      throw Error('Google Drive returned an error (' + response.status + ')' + (detail ? ': ' + detail : '.'));
    }
    return response;
  }

  async function findFile() {
    const q = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
    const r = await api(DRIVE + '?spaces=appDataFolder&fields=files(id)&orderBy=modifiedTime%20desc&pageSize=1&q=' + q);
    const data = await r.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function readFile(id) {
    const r = await api(DRIVE + '/' + encodeURIComponent(id) + '?alt=media');
    let data;
    try { data = await r.json(); } catch { data = null; }
    if (!data || data.format !== FORMAT || !Array.isArray(data.recipes)) {
      throw Error('The synced copy in Google Drive is not readable. Your recipes on this device are unchanged.');
    }
    return data;
  }

  async function writeFile(id, payload) {
    const body = JSON.stringify(payload);
    if (id) {
      await api(UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body
      });
      return id;
    }
    const boundary = 'recipe' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
    const r = await api(UPLOAD + '?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart
    });
    return (await r.json()).id;
  }

  // ---------- Sync ----------

  let running = false;
  let again = false;
  let timer = null;

  async function syncNow() {
    if (!CLIENT_ID || !state.connected) return;
    if (!hasToken()) { setStatus('paused'); return; }
    if (running) { again = true; return; }
    running = true;
    setStatus('syncing');
    try {
      const startedWith = JSON.stringify(recipes);
      const id = await findFile();
      const remote = id ? await readFile(id) : { recipes: [], deleted: {} };
      const merged = merge(
        { recipes, deleted: readDeleted() },
        remote,
        { firstSync: !state.lastSync }
      );
      if (JSON.stringify(recipes) !== startedWith) { again = true; return; } // edited mid-sync; start over
      if (JSON.stringify(merged.recipes) !== startedWith) applySyncedRecipes(merged.recipes);
      writeDeleted(merged.deleted);
      const remoteChanged = !id ||
        JSON.stringify(remote.recipes) !== JSON.stringify(merged.recipes) ||
        JSON.stringify(remote.deleted || {}) !== JSON.stringify(merged.deleted);
      if (remoteChanged) {
        await writeFile(id, { format: FORMAT, version: 1, saved: Date.now(), recipes: merged.recipes, deleted: merged.deleted });
      }
      pending = false;
      state.lastSync = Date.now();
      saveState();
      setStatus('synced');
    } catch (error) {
      if (error instanceof AuthError) setStatus('paused');
      else setStatus('error', error.message || 'Sync did not finish. Your recipes are still saved on this device.');
    } finally {
      running = false;
      if (again) { again = false; syncNow(); }
    }
  }

  function scheduleSync() {
    if (!CLIENT_ID || !state.connected) return;
    pending = true;
    clearTimeout(timer);
    if (!hasToken()) { setStatus('paused'); return; }
    paint();
    timer = setTimeout(syncNow, 1500);
  }

  async function fetchEmail() {
    try {
      const r = await api('https://www.googleapis.com/oauth2/v3/userinfo');
      const info = await r.json();
      if (info && info.email) { state.email = String(info.email); saveState(); }
    } catch {}
  }

  async function afterSignIn() {
    const firstTime = !state.connected;
    state.connected = true;
    offerRedirect = false;
    saveState();
    if (firstTime || !state.email) await fetchEmail();
    await syncNow();
  }

  function signInFailed(error) {
    setStatus(state.connected ? 'paused' : 'off', (error && error.message) || 'Google sign-in did not finish.');
    $('#sync-status').classList.add('sync-error');
  }

  // Must stay synchronous up to requestAccessToken(): browsers only allow the Google window
  // to open as a direct result of the tap.
  function startOrResume() {
    if (hasToken()) { syncNow(); return; }
    if (!googleReady()) {
      offerRedirect = true;
      loadGoogle().then(() => setStatus(status, 'Google sign-in is ready. Select the button again.'), signInFailed);
      setStatus(status, 'Getting Google sign-in ready…');
      return;
    }
    let pending;
    try { pending = signIn(); } catch (error) { signInFailed(error); return; }
    setStatus('syncing', 'Waiting for Google sign-in…');
    pending.then(afterSignIn).catch(signInFailed);
  }

  async function stopSyncing() {
    const ok = await appConfirm(
      'Your recipes stay on this device and in your Google Drive. This device just stops sending and receiving changes.',
      { title: 'Stop syncing on this device?', ok: 'Stop syncing' });
    if (!ok) return;
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token, () => {}); } catch {}
    }
    dropToken();
    state = {};
    saveState();
    pending = false;
    setStatus('off');
  }

  async function deleteRemoteCopy() {
    const ok = await appConfirm(
      'This removes the synced copy of your recipes from your Google Drive and stops sync on this device. Recipes on your devices are not deleted. Other devices will upload their recipes again the next time they sync.',
      { title: 'Delete the synced copy?', ok: 'Delete synced copy', danger: true });
    if (!ok) return;
    try {
      if (!hasToken()) { await loadGoogle(); await signIn(); }
      const id = await findFile();
      if (id) await api(DRIVE + '/' + encodeURIComponent(id), { method: 'DELETE' });
      if (window.google && google.accounts && google.accounts.oauth2) {
        try { google.accounts.oauth2.revoke(token, () => {}); } catch {}
      }
      dropToken();
      state = {};
      saveState();
      setStatus('off', 'The synced copy was deleted from your Google Drive.');
    } catch (error) {
      setStatus('error', error.message || 'Could not delete the synced copy.');
    }
  }

  // ---------- Wire up ----------

  function init() {
    if (!CLIENT_ID) { paint(); return; }
    $('#sync-open').addEventListener('click', () => {
      paint();
      $('#sync-dialog').showModal();
      if (!hasToken()) loadGoogle().catch(() => {});
    });
    $('#sync-go').addEventListener('click', startOrResume);
    $('#sync-redirect').addEventListener('click', signInWithRedirect);
    $('#sync-stop').addEventListener('click', stopSyncing);
    $('#sync-forget').addEventListener('click', deleteRemoteCopy);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.connected && hasToken() &&
          Date.now() - (state.lastSync || 0) > 30000) syncNow();
    });
    const back = takeRedirectResult();
    if (back && back.ok) {
      setStatus('syncing');
      afterSignIn().catch(signInFailed);
      return;
    }
    if (back && back.error) {
      offerRedirect = true;
      paint();
      $('#sync-dialog').showModal();
      signInFailed(Error(back.error));
      loadGoogle().catch(() => {});
      return;
    }
    if (state.connected) {
      setStatus(hasToken() ? 'synced' : 'paused');
      if (hasToken()) syncNow();
      else loadGoogle().catch(() => {});
    } else {
      setStatus('off');
    }
  }

  window.recipeSync = { merge, noteDeleted, scheduleSync, syncNow, enabled: !!CLIENT_ID };
  init();
})();
