# Recipe Aggregator

A personal recipe collection with a Neubrutalist interface, recipe imports, weekly meal selection, and grocery lists.

## What is included

- Recipe editor with name, categories, yield, source, ingredients, instructions, variations, and photos.
- Search, sorting, multiple category labels, grouped category view, personal ratings, and compact clickable cards.
- Detail view with two-column ingredients, basic Markdown, previous/next navigation, keyboard arrows, and click-outside dismissal.
- Optional sync across devices through each person's own Google Drive (see **Turn on sync**).
- Recipe page with prep, cook, and automatic total time; servings scaling (×¼ to ×4) that rewrites ingredient amounts; ingredient checkboxes; numbered step cards; Cook mode, which keeps the screen on where the browser allows; and Ingredients/Instructions tabs on phones. Logic lives in `assets/recipe-page.js`.
- Prep time and cook time are free text ("15 minutes", "1 hr 15 min", "overnight"); imported recipes bring theirs in from schema.org data.
- Substitutions: ingredient lines get a **⇄ Swap** button when there's a substitution for them. Onion opens a chart of fresh, dried minced, and powdered equivalents with the recipe's amount highlighted, plus a note on onion sizes. About 75 other ingredients, from The Old Farmer's Almanac's substitution list (buttermilk, eggs, butter, flours, sugars, cream, vinegars, wine, tomatoes, herbs, and more), open a list of stand-ins scaled to the amount in the recipe. All of them live in `assets/substitutions.js`.
- Recipe import with review before saving, from a bookmarklet, pasted page source or recipe JSON, or an optional import helper. Reads schema.org Recipe JSON-LD and microdata, Blueberry.org layouts and WP Recipe Maker pages, and falls back to the page title and photo.
- Uploaded-photo compression above 1 MB; JSON backup import and export.
- Rule-based Beautify and category suggestions; original text is retained when formatting changes it.
- Six accent palettes with a preview and Apply/Cancel settings.
- Weekly recipe selection with highlighted checkboxes and batch counts; editable grocery lists grouped by aisle, pantry exclusions, added items, plain-text Copy, and PDF download.
- Ingredient matching ignores common preparation words and excludes plain cooking water and ingredient headings. Ambiguous amounts are flagged rather than guessed.

## Data and privacy

Recipes, photos, preferences, and meal plans are saved in browser localStorage, separately for each browser and site. The site has no server or database of its own. This repository contains application source and generic image assets, not anyone's recipe library.

If sync is turned on, each person can sign in with Google. Their recipes are then kept in one file in their own Google Drive's hidden app folder (the `drive.appdata` permission), which this app can read but which gives it no access to their other Drive files. Recipes travel only between the browser and Google. `assets/privacy.html` explains this for visitors.

## Files

- `assets/index.html`: interface, recipe storage, imports, and settings.
- `assets/config.js`: public site settings: the Google client ID for sync and the optional import helper address.
- `assets/sync.js`: Google sign-in, the Drive app-folder file, and merging changes between devices.
- `assets/privacy.html`: plain-language privacy page linked from the sync window.
- `.github/workflows/pages.yml`: publishes `assets/` to GitHub Pages.
- `assets/recipe-markdown.js`: safe basic Markdown rendering and editor controls.
- `assets/meal-planner.js` and `.css`: meal planning, ingredient parsing, grocery-list editing and exports.
- `assets/vendor/`: bundled pdf-lib 1.17.1 and its license.
- `worker/template.js`: Cloudflare Worker request handling, static asset serving, and bounded public recipe-page fetching (the optional import helper).
- `scripts/build.sh`: embeds the assets in `dist/server/index.js`.
- `scripts/validate-artifact.mjs`: verifies that the build exports a Worker fetch handler.

## Build

Requires Bash, Python 3, and Node.js. No package install is required; the PDF library is bundled.

```sh
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

The output is a Cloudflare Worker ES module at `dist/server/index.js`.

For a local preview:

```sh
python3 -m http.server 8765 --directory assets
```

Open http://localhost:8765. Everything works here except fetching a recipe by its web address, which needs the import helper; the bookmarklet and paste imports work.

## Deploy on GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. On a free GitHub account the repository must be public; nothing secret is stored in it.
2. Push to `main`. The **Deploy to GitHub Pages** workflow publishes the `assets` folder to `https://YOUR-NAME.github.io/REPOSITORY/`.

## Turn on sync

Sync needs a free Google Cloud OAuth client ID. The ID is public by design: Google only accepts it from the web addresses you list. Never put a client *secret* in this repository; sync doesn't use one.

1. In the [Google Cloud console](https://console.cloud.google.com/), select or create a project.
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **Google Auth Platform → Branding**: enter the app name, a support email, the site's address as the home page, and `https://YOUR-NAME.github.io/REPOSITORY/privacy.html` as the privacy policy.
4. **Google Auth Platform → Audience**: choose **External**. While it says **Testing**, only the test users you list can sign in; select **Publish app** to let anyone use it. The app requests only non-sensitive permissions, so Google does not require a security review.
5. **Google Auth Platform → Data Access**: add the scope `https://www.googleapis.com/auth/drive.appdata`.
6. **Google Auth Platform → Clients → Create client**: type **Web application**. Under **Authorized JavaScript origins**, add the site's origin, such as `https://YOUR-NAME.github.io` or your custom domain (no path), plus `http://localhost:8765` for local testing. Under **Authorized redirect URIs**, add the site's full address with its trailing slash, such as `https://YOUR-NAME.github.io/REPOSITORY/` or `https://recipes.example.com/`. Sign-in goes to Google and comes back to that address.
7. Copy the client ID (it ends in `.apps.googleusercontent.com`) into `googleClientId` in `assets/config.js`, commit, and push.

How it behaves:
- **Sign in with Google** goes to Google's sign-in page in the same tab and comes back to the site when you're done. There's no pop-up window, so pop-up blockers don't get in the way.
- Each person signs in once per device. Google sign-ins made in the browser last about an hour; after that the Sync button shows **Resume sync**, and one tap continues without another permission screen.
- Each recipe keeps the time it was last changed. The newest version of each recipe wins, and deletions are remembered so they reach every device.
- The first time a device syncs, recipes that are already in Drive under a different ID (for example, both devices restored the same backup) are matched by name and ingredients instead of duplicated.
- Meal plans and color palettes stay on each device.

## Recipe import on a static site

Recipe sites can't be fetched from the browser directly, and GitHub Pages has no server. The import window therefore offers:
- **Bookmarklet**: drag **＋ Save to Recipes** to the bookmarks bar, then click it on a recipe page. It sends that page's HTML to the app in a new tab. Because it reads the page you already have open, it works on sites that block automated requests.
- **Paste**: paste the page source or recipe JSON, like Mealie's "Import from HTML or JSON". This is the simplest option on phones.
- **Web address** (optional): deploy the Worker below as an import helper and set `importHelperUrl` in `assets/config.js`.

### Import helper (Cloudflare Worker)

The Worker in `worker/template.js` fetches a public recipe page so "From a web address" works on any device, including phones. `wrangler.toml` deploys it as a small helper (no website files are bundled). It only fetches public HTTPS pages up to 2 MB, follows at most three redirects, and only answers the sites listed in `ALLOWED_ORIGINS`.

1. In the Cloudflare dashboard, open **Workers & Pages → Create → Import a repository**, and pick this repository.
2. Leave the build command empty and keep the deploy command `npx wrangler deploy`. Deploy.
3. Copy the Worker's address (`https://recipe-import-helper.<your-subdomain>.workers.dev`) and set `importHelperUrl` in `assets/config.js` to that address plus `/api/recipe-page`.
4. If the site moves to another address, update `ALLOWED_ORIGINS` in `wrangler.toml`.

On phones the import window then shows a **Paste** button next to the link box. Opening `https://<site>/?import=<recipe link>` also starts an import, which works with an iPhone Shortcut or an Android share shortcut.

`bash scripts/build.sh` still produces `dist/server/index.js`, a Worker that serves the whole site plus the helper, for hosting everything on Cloudflare instead.

## Sharing and changes

Each copy of the site keeps its own browser data. With sync turned on, people's recipes live in their own Google Drive and not with whoever runs the site. If using an AI coding agent, ask it to preserve the existing source and behavior rather than replacing it with a newly generated approximation.
