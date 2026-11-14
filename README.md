# Recipe Aggregator

A personal recipe collection with a Neubrutalist interface, recipe imports, weekly meal selection, and grocery lists.

## What is included

- Recipe editor with name, categories, yield, source, ingredients, instructions, variations, and photos.
- Search, sorting, multiple category labels, grouped category view, personal ratings, and compact clickable cards.
- Detail view with two-column ingredients, basic Markdown, previous/next navigation, keyboard arrows, and click-outside dismissal.
- URL import with review before saving: schema.org Recipe JSON-LD, Blueberry.org layouts, and WP Recipe Maker pages.
- Uploaded-photo compression above 1 MB; JSON backup import and export.
- Rule-based Beautify and category suggestions; original text is retained when formatting changes it.
- Six accent palettes with a preview and Apply/Cancel settings.
- Weekly recipe selection with highlighted checkboxes and batch counts; editable grocery lists grouped by aisle, pantry exclusions, added items, plain-text Copy, and PDF download.
- Ingredient matching ignores common preparation words and excludes plain cooking water and ingredient headings. Ambiguous amounts are flagged rather than guessed.

## Data and privacy

Recipes, photos, preferences, and meal plans are saved in browser localStorage, separately for each browser and origin. This repository contains application source and generic image assets, not the owner's saved recipe library. To transfer recipes, use Export in the original app and Import backup in the new app. Automatic Google Drive, Dropbox, and Pinterest synchronization is not implemented.

The original hosted Site identity, credentials, generated deployment output, and Git history are excluded. This is a standalone source snapshot. Keep a new deployment private unless you deliberately choose another audience.

## Files

- `assets/index.html`: interface, recipe storage, imports, and settings.
- `assets/recipe-markdown.js`: safe basic Markdown rendering and editor controls.
- `assets/meal-planner.js` and `.css`: meal planning, ingredient parsing, grocery-list editing and exports.
- `assets/vendor/`: bundled pdf-lib 1.17.1 and its license.
- `worker/template.js`: Cloudflare Worker request handling, static asset serving, and bounded public recipe-page fetching.
- `scripts/build.sh`: embeds the assets in `dist/server/index.js`.
- `scripts/validate-artifact.mjs`: verifies that the build exports a Worker fetch handler.

## Build

Requires Bash, Python 3, and Node.js. No package install is required; the PDF library is bundled.

```sh
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

The output is a Cloudflare Worker ES module at `dist/server/index.js`.

For a visual-only local preview:

```sh
python3 -m http.server 8765 --directory assets
```

Open http://localhost:8765. Recipe editing, browser storage, meal planning, and grocery export work in this preview. URL import needs the Worker endpoint `/api/recipe-page`, so it does not work with the static Python server.

## Deployment

With Codex Sites, register a NEW private Site, put that new Site's project ID in `.openai/hosting.json`, build, and publish using the Sites workflow. The empty manifest here intentionally contains no identity from the original installation. Do not reuse the original owner's Site ID or repository credentials.

Alternatively, deploy the generated Worker with your own Cloudflare tooling and configure access controls for your audience. Authentication of the original private Site is provided by its hosting platform; it is not implemented inside this source snapshot. The recipe-page endpoint accepts same-origin requests and only fetches bounded public HTTPS HTML pages. Some recipe websites block automated requests or use unsupported formats.

## Sharing and changes

Copy this repository for an independent installation. Browser data is not shared between copies. If using an AI coding agent, ask it to preserve the existing source and behavior, set up a new private deployment, and avoid replacing the implementation with a newly generated approximation.

The generic food images were AI-generated. Third-party code retains its included license. No project-wide open-source license has been selected by the owner.
