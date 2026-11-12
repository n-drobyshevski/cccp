# CCCP

Cyber, Compliance, Continuity, Platform: a view-only application register as a standalone Google
Apps Script web app. Agents: read `CLAUDE.md` first. Provenance of reused code: `VENDOR.md`.
Release audit results and the manual live `/exec` checklist: `VERIFY.md`.

## Dev loop

```
npm install
npm run check          # typecheck, lint, vendor:verify, test
npm run vendor:verify  # sha256 + import containment of src/vendor
```

Other scripts:

```
npm run build       # writes dist/ (server.js, js_app.html, styles.html, index.html, entry.js, appsscript.json)
npm run dev         # dev server on http://localhost:8791 with fake Sheets, Drive and Script Properties
npm run test:build  # build, then the build-guard tests
npm run e2e         # Playwright against the dev server; Chrome locally, Playwright chromium when CI is set
```

Dev flags (query string): `as=<email>`, `mode=org`, `admins=<list>`, `nosource`, `empty`,
`coldcache`, `slow=<ms>`, `tz`, `inline`. Seeds: `owner@example.com` (owner), `admin@example.com`,
`viewer@example.com`. The dev fakes reset on every page load.

## End-to-end tests

`e2e/smoke.spec.ts` walks every page and a Settings save, covers access (owner, viewer, stranger,
both org-mode outcomes), keyboard reach, popover Escape focus return, the focus ring and text
contrast in both themes, and requires zero console errors. `e2e/screens.spec.ts` captures every
page in both themes at 1280 and 820 px into `$SHOTS_DIR` (default: a temp folder, never the repo)
for comparison with `mockups/`. Run one spec with `npx playwright test e2e/smoke.spec.ts --trace off`.
Never start the dev server on :8791 and leave it running: `test/server/devServer.test.ts` needs the port.

## CI

`.github/workflows/ci.yml`: Node 22, `TZ=UTC`, `npm ci`, `npm run check`, install chromium,
`npm run e2e`; screenshots and, on failure, `test-results` are uploaded as artifacts.

## Vendoring

`src/vendor` is verbatim sidekick code pinned at `77bcf22` (see `VENDOR.md`). Re-sync:

```
npm run vendor:diff -- --to <sha>
node tools/vendor.mjs sync --from /home/user/sidekick --commit <sha>
```

## Deploy

1. `clasp login` as the OWNER, who needs view access to the register Sheet.
2. `clasp create --type webapp --title CCCP --rootDir dist`.
3. `npm run push` (runs check, then `clasp push`).
4. In the Apps Script editor run `setup('<sheet url>')` and grant the 4 scopes.
5. `npm run deploy:new` once; record the DEPLOYMENT_ID and the `/exec` URL.
6. Open the URL as the owner and configure Settings.
7. Later releases: `DEPLOYMENT_ID=... npm run deploy` (updates in place).
8. Rollback: `clasp deploy -i <DEPLOYMENT_ID> -V <previous version>`.
9. Run `deploymentDiagnostic` after each deploy, then work through the live checklist in `VERIFY.md`.
