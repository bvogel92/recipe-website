// Site settings. Everything in this file is public: it is served to every visitor.
// Never put passwords, API secrets or OAuth client *secrets* here.
window.RECIPE_CONFIG = {
  // Google OAuth client ID (a "Web application" client) that turns on "Sync with Google Drive".
  // It looks like 1234567890-abc123.apps.googleusercontent.com. Leave empty to hide sync.
  // Setup steps are in README.md under "Turn on sync".
  googleClientId: '303486450590-i7hfqjnpkrik4pg1m8gnnpuctg6kmvat.apps.googleusercontent.com',

  // Optional address of a recipe-page import helper (the Cloudflare Worker in worker/).
  // With it, "Import a recipe" can fetch a recipe from its web address.
  // - Site hosted by that Worker itself: '/api/recipe-page'
  // - Site on GitHub Pages with a separate Worker: 'https://YOUR-WORKER.workers.dev/api/recipe-page'
  // Leave empty to import with the bookmarklet or by pasting the page instead.
  importHelperUrl: 'https://recipe-import-helper.bvog92.workers.dev/api/recipe-page'
};
