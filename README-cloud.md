# Recipe Aggregator — Cloud Storage & Sign-In

This document covers the optional cloud layer: sign in with **Google**, and your
recipe collection syncs to a "Recipe Collection" folder in Google Drive —
replacing browser cookies/localStorage as the stable store. Everything still
works fully offline and local-only if you never sign in.

## Where the app is served

- **On the Mac:** http://localhost:8000
- **From any device on your tailnet:** https://mac-studio.pipefish-brill.ts.net:8445/
  (proxied to `127.0.0.1:8000` by `tailscale serve`; tailnet-only, HTTPS with a
  valid certificate)

## How it works

- **Identity and storage are one step.** Google sign-in stores your collection in
  Google Drive. (Apple sign-in was evaluated and dropped: Apple has no web API for
  iCloud Drive, so it could never be the storage backend for a web app.)
- **Consented folder.** On first sign-in the app asks you to allow storage in your
  account. On "Allow" it creates (or reuses) a **`Recipe Collection`** folder in
  your Drive and treats it as the **source of truth**.
- **Local caching.** `localStorage` stays the working copy (recipes keep their photos
  inline, exactly as before), so the app loads fast and works offline. In the cloud
  folder, photos are stored as separate files and `recipes.json` only references
  them, so the JSON stays small. Photos are uploaded only when they change.
- **Sync.** Pull + merge on sign-in and on every sync (merged by recipe `id`; the
  copy with the newer `updatedAt` wins; deletions are remembered so a deleted
  recipe is never brought back by another device), then a debounced push about
  1.2 s after any change. The app also syncs when the tab becomes visible again,
  when the device comes back online, and every few minutes while open. The header
  button shows `Sign in to sync / Syncing… / Synced / Sync error / Reconnect`.
  Signed out or offline → local-only mode; nothing is lost.
- **Which account?** The consent prompt and the account dialog show the exact
  Google account the collection is saved to, with a link to its folder in Drive.
  Google's account chooser is always shown on sign-in, and the consent prompt has
  a "Use a different account" link.

## Cloud folder layout

```
Recipe Collection/
├── recipes.json     # your recipes (images referenced by img/<id>.<ext>, not embedded)
├── plan.json        # the weekly meal plan
└── img/
    └── <id>.<ext>   # one file per recipe photo
```

`recipes.json` also keeps a small `deleted` map (recipe id → time) so deletions sync.
Files the app replaces or removes go to the Drive trash, so they can be recovered.

The folder name and file names are fixed by the app; if a folder named
`Recipe Collection` already exists at your Drive root, it is reused.

## Quickstart (mock mode — no credentials needed)

To exercise the entire sign-in → consent → sync flow against a local folder on the
app server, enable mock cloud:

1. Set `"dev": { "mock_cloud": true }` in `cloud-config.json` (no restart needed —
   the config is re-read on every page load).
2. Open http://localhost:8000 (on the Mac) or
   https://mac-studio.pipefish-brill.ts.net:8445/ (any tailnet device).
3. Click **Sign in to sync** in the header → the account dialog shows the Google
   button (disabled if no client ID is set) plus an enabled **Mock** button.
4. Click **Mock cloud** → the consent prompt appears ("Save your recipes to the mock
   cloud?") → **Allow and sync**.
5. The dot turns green (**synced**). Create/edit/delete recipes and a meal plan; the
   data is written to `~/.recipe-collection-cloud/` on this machine.
6. Reload the page — the session is restored (green dot) and your data is intact.
   **Sign out** leaves your recipes fully usable as a local-only collection.

Mock mode is a development convenience. It stores files under
`~/.recipe-collection-cloud/` on the machine running the server and is **not** a real
cloud backend — for real sync, configure Google credentials below. (Mock mode also
lets you test the sign-in UX while provider credentials are pending.)

## Google (Drive) setup

Copy `cloud-config.json.example` to `cloud-config.json` and fill in the client ID.
An unconfigured provider shows a "not configured yet" note. The config is re-read on
every page load, so no restart is needed after editing it.

Sign-in uses the OAuth authorization-code flow with **PKCE**. Google requires the
client secret to redeem the code for a "Web application" client (even with PKCE),
so `serve.py` performs that one exchange at `POST /api/oauth/google/token`, adding
`google.client_secret` from `cloud-config.json`. The secret never reaches the browser.
That's also what lets the app refresh its access token, so you stay signed in.

If `client_secret` is left out, the app falls back to Google's browser-only token
flow. It works, but access tokens last an hour and you'll need to choose
**Reconnect** after that, so setting the secret is recommended.

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library → Google Drive API → Enable.** Without this, sign-in
   succeeds but every save fails with "Google Drive API has not been used in
   project … or it is disabled" (the account dialog shows this as a sync error).
3. **APIs & Services → OAuth consent screen** — External (or Internal if you have a
   Google Workspace domain). The app only requests
   `https://www.googleapis.com/auth/drive.file` (its own files) plus profile
   name/email for the sign-in UI.
4. **APIs & Services → Credentials → Create OAuth client ID → Web application**.
5. Add the **Authorized redirect URIs**. The one the app actually uses:
   - `https://mac-studio.pipefish-brill.ts.net:8445/oauth-callback.html` (tailnet)
   And optionally, if you also sign in from a browser on the Mac via
   `http://localhost:8000`:
   - `http://localhost:8000/oauth-callback.html` (local dev)
   Also add the **Authorized JavaScript origins** (same box, no trailing slash):
   - `https://mac-studio.pipefish-brill.ts.net:8445` (tailnet)
   - `http://localhost:8000` (local dev)
6. Set `redirect_uri` in `cloud-config.json` to the **tailnet** URL, character for
   character. Google compares scheme, host, port and path exactly, so it must match
   one of the URIs registered in step 5. Keep it set to the tailnet URL: the OAuth
   callback runs in the browser of whatever device started sign-in, so a
   `localhost` redirect can only complete on the Mac itself. (The tailnet redirect
   also works when the app is opened at `http://localhost:8000` on the Mac — the
   callback page posts the code back to the opener window, which the app validates
   with the PKCE `state`.)
7. Copy the **Client ID** into `cloud-config.json` → `google.client_id` and the
   **Client secret** into `google.client_secret`. (`cloud-config.json` is
   git-ignored; the secret is only used server-side.)
8. **Add your account as a test user (or publish the app).** A new consent
   screen defaults to **Testing** state, and in that state *only* accounts
   listed under **OAuth consent screen → Test users** may sign in. Add the
   Google account you actually use — otherwise sign-in fails with
   `Error 403: access_denied` ("app has not yet been verified"). While in
   Testing, Google expires refresh tokens after 7 days, so expect to
   re-authorize about weekly. (Marking the app **In production** removes the
   test-user limit but, for an External app, requires Google's verification
   process — usually not worth it for a personal app.)

> **Production note:** `serve.py` is intentionally thin and portable so it can be
> ported to a **Cloudflare Worker** (the intended production target for this app).
> Sign-in and storage are entirely client-side; the remaining `/api/config` and
> mock-cloud endpoints are trivial to keep or drop. Today the app is served to the
> tailnet at `https://mac-studio.pipefish-brill.ts.net:8445/` via `tailscale serve`.

## Sign-out & local-only mode

- **Sign out** clears the cloud session (not the local cache). All recipes, plans and
  images remain in the browser and keep working offline.
- If the server is unreachable or the user is offline, the app silently falls back to
  local-only and shows the error state on the status dot; changes are not lost — they
  stay in the local cache.

## Export / import

The existing JSON export/import keeps working and is now round-trip compatible with
the cloud format:

- **Export** writes the local collection with photos embedded as base64, so the file
  is a standalone snapshot (same as before this feature).
- **Import** works as before (matching source links keep their ratings), and the
  imported recipes sync like any other change.

So "Export JSON" remains a portable backup of everything, cloud or not.

## Troubleshooting

- **Popup blocked / "Sign-in cancelled"** — the OAuth window opens as a popup in
  browsers that support them; allow popups for the app origin
  (`localhost:8000` or `mac-studio.pipefish-brill.ts.net:8445`). In browsers or
  in-app browsers with no pop-up support, the app automatically falls back to a
  full-page redirect: the tab goes to Google and comes back, then finishes
  sign-in from `sessionStorage`. The app also shows the raw OAuth error in the
  account dialog's note line.
- **Button says "not configured yet"** — the client ID is missing/empty in
  `cloud-config.json`; add it and reload the page.
- **`redirect_uri` mismatch** — the exact `redirect_uri` in `cloud-config.json` must
  match the authorized redirect URI registered with Google, character for character
  (including scheme and port — `http` vs `https` and `:8445` both matter).
- **`client_secret is missing` when finishing sign-in**: Google needs the client
  secret to redeem the sign-in code. Put the OAuth client's **Client secret** in
  `cloud-config.json` → `google.client_secret` and reload. You don't need a new
  client.
- **Signed in, but nothing appears in Drive**: open the account dialog (header
  button). The **Problem** row shows the exact Drive error. The usual causes are
  that the **Google Drive API isn't enabled** for the project (setup step 2), or
  that the Drive permission was unticked on Google's consent screen (sign out,
  sign in again, and leave it ticked). Also check that the **Saved to** link opens
  the folder in the Google account you expect.
- **Pop-up opens but nothing happens**: the app accepts the result even if
  Google's pages cut the link between the pop-up and the app tab. If the pop-up
  stays open, close it, and the app picks up the result once it lands.
- **`Error 403: access_denied` on the Google sign-in page** — the OAuth consent
  screen is in **Testing** and the account you're signing in with isn't listed
  under **Test users** (or the client is disabled). Add the account under
  **APIs & Services → OAuth consent screen → Test users**, confirm
  `https://mac-studio.pipefish-brill.ts.net:8445` is in the client's
  **Authorized JavaScript origins**, and make sure you're signed in at Google
  with the account that is a test user. Workspace-managed accounts may also
  need the admin to allow third-party OAuth apps.
- **Google `access_denied` / `invalid_grant` on refresh** — the refresh token was
  revoked or expired (Google refresh tokens last ~6 months idle). Sign in again.
- **`409 conflict` / quota errors** — your Drive account hit a limit (e.g. many large
  photos). Delete old recipes/photos or free up account space; the sync status dot
  shows `error` and the account dialog shows the last error message.
- **Images not showing after moving browsers**: photos are downloaded from the
  cloud folder during the first sync on a new browser. If you cleared browser data,
  they come back on the next sync after you sign in.
- **A "Recipe Collection" folder you made yourself is ignored**: the app's
  `drive.file` permission only lets it see folders it created, so it makes its own.
  The same happens if you switch to an OAuth client in a different Cloud project.
- **Mock mode** only works while the *local* `serve.py` is the server (it writes to
  `~/.recipe-collection-cloud/` on the server's machine) and is disabled in the
  production config.

## File map

| File | Purpose |
| --- | --- |
| `assets/cloud.js` | All cloud logic: Google OAuth (PKCE, pop-up with redirect fallback), stores (Drive/Mock), merge + sync engine, session management. Exposes `window.RC`. |
| `assets/cloud.css` | Styles for the account button, provider grid, and the consent/account dialogs (matches the app theme). |
| `assets/oauth-callback.html` | OAuth redirect target; hands the `code`/token, `state` and `error` back to the app tab (`postMessage`, `BroadcastChannel` or storage) and closes. |
| `assets/index.html` | App UI + wiring: account button in header, account + consent dialogs, `RC.*` hooks in the save/export/import/meal-plan paths. |
| `assets/meal-planner.js` | Meal-plan persistence hook (`RC.onLocalSave()`) + re-render on `rc:plan-changed`. |
| `serve.py` | Local server: static files + `/api/recipe-page` + `/api/config` + `/api/oauth/google/token` + mock-cloud endpoints. |
| `cloud-config.json` | **Your** config (gitignore-style secret; don't share). |
| `cloud-config.json.example` | Documented template. |
