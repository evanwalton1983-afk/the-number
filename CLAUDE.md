# House rules

Follow these in every task.

1. Additive changes only. Keep every existing feature, data field and prediction formula working
   unless the task says otherwise.
2. Keep the current architecture. If this is a single-file HTML PWA, keep it single-file, load
   libraries from a CDN with pinned versions, and add no build step.
3. Free plans only (Supabase free, Netlify free). Warn me before anything that could push past a
   free limit.
4. Don't add paid services or new API keys without asking me first.
5. No em dashes or en dashes anywhere: UI text, code comments, docs.
6. If you copy code from an MIT licensed repo, keep its copyright and license notice in a comment
   above that code.
7. Bump the version number shown in the app and add a dated line to CHANGELOG.md.
8. Before saying done, test at phone width and tell me exactly what to tap to check it.

## How they apply to The Number

- **Rule 1.** The math lives in `src/odds.js`, `src/dists.js`, `src/market.js`, `src/promos.js`
  and `src/grade.js`; `npm test` covers it and must still pass. Bets and settings live on the
  phone in IndexedDB (`src/store.js`) and travel in the backup and War Room files, so a change
  must still read what is already there.
- **Rule 2.** The source is not a single file: it is modules in `src/` that `npm run build`
  (esbuild) inlines into one file, `public/index.html`, plus the Netlify functions in
  `netlify/functions`. Keep that build and layout, and add no other build tools. Edit `src/`, not
  `public/index.html` or `public/sw.js` (the build writes both). The Content Security Policy in
  `netlify.toml` blocks scripts and fonts from other sites, so a CDN script tag would not load:
  add a library as an npm package pinned to an exact version (no `^` or `~`), as esbuild is in
  `package.json`, and the build bundles it.
- **Rule 3.** Watch Netlify's free plan (builds and deploys, bandwidth, function calls) and the
  Odds API credits on the key's plan (see "Odds API credits" in README.md). Adding markets,
  sports, books or more frequent scans costs credits: warn first.
- **Rule 4.** The keys today are `ODDS_API_KEY` and `APP_PASSCODE` in Netlify's environment
  variables. Anything else counts as new.
- **Rule 5.** `npm run check:dashes` checks every text file here, this one and CHANGELOG.md
  included. It must pass.
- **Rule 7.** The version is `APP_VERSION` in `src/app.js`. It shows at the bottom of Settings
  ("The Number 1.0.0.") and goes into backups. Set `version` in `package.json` to match and run
  `npm run build` so the built app carries it. 1.0.0 to 1.0.1 for a fix, 1.1.0 for a feature.
  CHANGELOG.md sits in this folder (create it on the first change), newest line first:
  `- YYYY-MM-DD, x.y.z: what changed, in plain words.`
- **Rule 8.** Run `npm install` once, then `npm run build` and `node tests/e2e/server.mjs`: it
  serves `public/` at http://localhost:4510 with a scripted market (passcode `test-pass`). Check
  it at 390 by 844, the phone size `npm run e2e` uses; `npm run e2e` runs the whole scripted night
  (needs Playwright with Chromium). The tabs are Edges, Games, Promos, Record and Settings. Start
  my tap list with the version at the bottom of Settings, so I can tell the new build loaded.
