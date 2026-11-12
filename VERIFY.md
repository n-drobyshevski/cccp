# VERIFY: final verification and live-deployment checklist

Audit of commit `76404f3` (WP01 to WP20), run in this container on 12 Nov 2026. Nothing needed
fixing: the audit found no violation, so no source file changed in WP21.

## 1. Clean clone

`git clone /home/user/cccp /tmp/cccp-verify`, then in the clone:

| step | result |
|---|---|
| `npm ci` | exit 0 |
| `npm run check` (typecheck, lint, vendor:verify, test, test:build) | exit 0; build guards 203 tests pass |
| `npm run e2e` (CI=1, 2 workers) | 156 passed, 0 failed (2.8 min) |
| `TZ=Pacific/Kiritimati npm test` | 54 files, 829 passed, 1 skipped (the sample-CSV test, file absent) |
| `npm run vendor:verify` | `vendor:verify ok (16 files @ 77bcf22)` |

Environment note: this container has Playwright chromium build 1243 but `@playwright/test` pins
1254, so the stock `CI=1 npm run e2e` cannot launch a browser here (`Executable doesn't exist`).
The run above used a throwaway config in the clone (not committed) that wraps
`playwright.config.ts` and sets `launchOptions.executablePath` to
`/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`. On a machine with a matching
`npx playwright install chromium` the committed config works unchanged. The vitest zone suites set
`process.env.TZ` per suite (`test/domain/tz.ts`), so the Kiritimati run exercises the date code in
UTC+14 as well as UTC.

## 2. Grep audit

| invariant | command (from repo root) | result |
|---|---|---|
| `SpreadsheetApp` only in `sourceSheet.ts` | `grep -rln SpreadsheetApp src` excluding vendor | `src/server/sourceSheet.ts` only |
| Sheets and Drive advanced services only in `exportSheet.ts` | `grep -rnE "\b(Sheets\|Drive)\.[A-Za-z]" src --include=*.ts --include=*.js` excluding vendor; also `grep -rlE "\bSheets\b\|\bDrive\b" src/server src/gas` | calls in `src/server/exportSheet.ts` only (`Sheets!.Spreadsheets!.create/update/batchUpdate`, `Drive!.Permissions!.create`); the only other hit is the service declaration in `src/gas/appsscript.json` |
| `innerHTML` only in `renderRegion` | `grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML" src` excluding vendor | `src/client/lib/dom.js:57` (`el.innerHTML = String(safe)`) plus a comment on line 2; no `outerHTML`, no `insertAdjacentHTML` |
| No source mutators in `src/server` | `grep -rn "setValue\|appendRow\|clearContent\|setValues\|insertSheet\|deleteSheet\|mutat" src/server` | no match |
| No `title` attributes | `grep -rnE "title=\|\.title\s*=\|setAttribute\(.title" src/client`; `test/build/noTitleAttr.test.js` | no attribute use (the one hit is `m.title === ""`, a data field); static test passes |
| No colour literals outside tokens | `grep -rlE "#[0-9a-fA-F]{3,8}\b\|rgba?\(\|hsla?\(" src/client`; `test/build/noHexOutsideTokens.test.js` | `src/client/styles/tokens.css` only; static test passes |
| No `//` violations | `test/build/guards.test.js` and `htmlLowering.test.js` replay the middlebox comment stripping over the built JS and CSS; no backticks in the bundle | pass. The only `//` in client sources are comments and the two `https://fonts.googleapis.com` attributes in `src/client/index.html`, which are HTML attribute values outside the guarded JS and CSS (`dist/js_app.html` and `dist/styles.html` contain none) |
| Every export in `roles.ts` and `entry.js` | script over `exportedNames(api.ts)`, plus `roleMatrix` "covers every export of api.ts" and `roles` "classifies every export of api.ts" | 14 exports, all 14 in `ENDPOINT_ROLES` and all 14 in `entry.js` (15 `timedApi_` references: 14 delegators and the definition) |
| Manifest has exactly 4 scopes | `test/build/manifestScopes.test.js`; `dist/appsscript.json` | `spreadsheets` (SpreadsheetApp.openById refuses `.readonly`; the source stays read-only by code and static scans), `drive.file`, `userinfo.email`, `script.scriptapp`; webapp `DOMAIN` / `USER_DEPLOYING`; advanced services Sheets v4 and Drive v3 |

## 3. Role matrix and leak tests

`npx vitest run --project server test/server/roleMatrix.test.ts test/server/bootstrap.test.ts test/server/roles.test.ts --reporter=verbose`:
3 files passed, 93 tests passed. Every RPC goes through `src/gas/entry.js` in a node vm as five
identities; the outcome must equal `ENDPOINT_ROLES` exactly (REFUSED is the `forbidden` envelope
with nothing written):

| endpoint | needs | caller outcomes (owner, admin, listed viewer, stranger, anonymous) |
|---|---|---|
| api_bootstrap | viewer | run owner; run admin; run listed viewer; REFUSED stranger; REFUSED anonymous |
| api_getRegister | viewer | run owner; run admin; run listed viewer; REFUSED stranger; REFUSED anonymous |
| api_getAccess | viewer | run owner; run admin; run listed viewer; REFUSED stranger; REFUSED anonymous |
| api_saveAccess | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_saveAdmins | owner | run owner; REFUSED admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_saveAccessMode | owner | run owner; REFUSED admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_getSettings | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_probeSource | owner | run owner; REFUSED admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_saveSettings | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_reloadData | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_saveSharedView | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_deleteSharedView | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_getDiagnostics | admin | run owner; run admin; REFUSED listed viewer; REFUSED stranger; REFUSED anonymous |
| api_exportToSheet | viewer | run owner; run admin; run listed viewer; REFUSED stranger; REFUSED anonymous |

Other roleMatrix tests:
- covers every export of api.ts and nothing is unclassified
- the owner's calls all succeed with sensible parameters, and none touches the source
- an admin sheetId patch is refused through entry.js and a rules patch is accepted
- org mode: a same-domain address is a viewer, so admin endpoints refuse it

bootstrap, roles tests:
- roles > ENDPOINT_ROLES > classifies every export of api.ts (fails on an unclassified one)
- roles > ENDPOINT_ROLES > matches the architecture table
- roles > ENDPOINT_ROLES > is fail closed for names it does not know, including inherited ones
- roles > roleAllows > ranks viewer < admin < owner and denies a null role
- roles > the gate in run() > a refused call never reaches setProperty
- roles > the gate in run() > refuses an unidentified caller on a viewer endpoint
- roles > the gate in run() > records no refusal or input-validation error in the error log
- roles > the gate in run() > keeps an ApiError's kind (busy, conflict) and does not log it
- bootstrap > bootstrap > keeps the core within the allowlist and the viewer in the live part
- bootstrap > bootstrap > gives two viewers an identical core and different flags
- bootstrap > bootstrap > puts no email anywhere in the cache
- bootstrap > bootstrap > still answers when the configured Sheet cannot be opened
- bootstrap > bootstrap > recomputes the live part on every call but not the core
- bootstrap > bootstrap > inlines the register when it is warm and under 600 KB
- bootstrap > bootstrap > does not inline the register when it is cold, and does not read the Sheet to find out
- bootstrap > bootstrap > does not inline a register above 600 KB
- bootstrap > bootstrap > works with no source configured: an empty core, nothing mapped
- bootstrap > bootstrap > rebuilds the core after a rules save but not the register
- bootstrap > bootstrap > is refused for someone who is not allowed in

The leak test is `bootstrap > puts no email anywhere in the cache`: after five identities call
`bootstrap` and `getRegister`, the stored core and register must contain no `@`, and no cache key
may contain any of the identities' addresses. It passes, as does `gives two viewers an identical
core and different flags`.

Owner-only operations as an admin in the dev UI (`npm run dev`, `?as=admin@example.com`, Settings,
Access, calling the page's RPC globals):

```
api_saveAdmins      {"ok":false,"error":"You don't have permission to do that.","errorKind":"forbidden"}
api_saveAccessMode  {"ok":false,"error":"You don't have permission to do that.","errorKind":"forbidden"}
api_probeSource     {"ok":false,"error":"You don't have permission to do that.","errorKind":"forbidden"}
api_getSettings     ok (admin endpoint)
api_saveAccess      ok (admin endpoint)
UI: mode radio read-only ("Only the owner"), no Admins editor, no Probe button
```

## 4. Visual comparison with the mockups

Screenshots (both themes, 1280 px) were taken from the dev server and the approved mockups and
compared side by side: Overview, List, Heatmap, Landscape, fact sheet and Settings against
`cccp-round3.html`, `cccp-leanix2.html` and `cccp-settings.html`. The earlier per-package fidelity
reviews (`e2e/fidelity.spec.ts`) cover the rest. Layout, typography, spacing, colours, dark theme
and tab and sidebar structure match. Remaining differences, all justified:

- Data differs (the mockups use their own generated data; the dev fixture is a synthetic
  1,125-row register), so counts, domain names and percentages differ.
- The theme button shows a moon in light mode and a sun in dark mode (the icon of the theme you
  switch to); the mockups draw a sun in both. Kept: the icon states the action.
- Settings, Data source has a Probe button next to the Sheet URL and a different tab-table column
  spacing: Probe is the owner-only operation in the architecture; the mockup predates it.
- The mockup's amber dot on the Field mapping tab is data dependent (shown when columns are
  missing) and the fixture maps cleanly.
- The mockup pages carry a design-option header (layout pickers and prototype notes) that is
  never part of the product.

## 5. Sizes and timings (dev server, 1,127 rows, headless chromium, unthrottled)

| measure | value |
|---|---|
| Register payload (`api_getRegister`, columnar codec, JSON) | 324,444 bytes (inline limit 600 KB) |
| Inline boot (`api_bootstrap` with the register attached) | 327,767 bytes: core 3,004, live 271, register 324,444 |
| `dist/js_app.html` / `styles.html` / `server.js` | 166,349 / 45,501 / 113,715 bytes |
| Dev first paint (first-contentful-paint), register fetched | 548 ms (DOMContentLoaded 904 ms) |
| Dev first paint with `?inline` (boot inlined) | 988 ms (DOMContentLoaded 970 ms); the Google Fonts request is blocked in this sandbox, which adds to both |

These are dev-server numbers; real first paint on `/exec` depends on Apps Script latency and is
item 7 below.

## 6. Known sandbox limits

`google.script.url`, `google.script.history`, the HtmlService sandbox, domain-only access, drive.file
sharing and Google Fonts delivery cannot be exercised here. The checklist below covers them.

## 7. Manual live `/exec` checklist

Do this once after `npm run deploy:new`, with the deployed `/exec` URL. Tick each box.

Setup
- [ ] `setup('<sheet url>')` was run as the owner and the 4 scopes were granted (no extra scope prompt).
- [ ] `deploymentDiagnostic`, run from the Apps Script editor as the owner (it asserts the owner and logs the report), is clean: source readable, tabs found, advanced services enabled, properties present, no warnings. Run it again after every deploy.

Page
- [ ] Fonts: Inter and IBM Plex Mono render (Network tab shows `fonts.googleapis.com` and the font files loading inside the Apps Script iframe). If blocked by policy, the system fallbacks stay legible and nothing overflows.
- [ ] Address bar sync: navigating Overview, List, Heatmap, Landscape, a fact sheet and Settings changes the browser address bar query (`?r=`, `?app=`), Back and Forward move between them, and a reload on any of them returns to the same page.
- [ ] Copied links: the fact sheet link button, a personal view link and a shared view link (`?view=<id>`) copied from the live page open the same page and filters in a new tab and for a second user; the copied text is the `/exec` URL with the query, not the `googleusercontent` iframe URL, and contains no double slash beyond the scheme.
- [ ] First load: the register arrives (inline when warm, fetched when cold); reload while warm shows content without a visible spinner; "Reload data" in Settings refreshes the timestamp.
- [ ] Theme toggle persists after reload; with storage blocked (private window) the page still works and personal controls hide.

Export
- [ ] CSV and Excel downloads work from the live page.
- [ ] drive.file export sharing: "New Google Sheet" as a non-owner viewer creates the file (`Sheets.Spreadsheets.create`, `values.update`, `batchUpdate`) and shares it to the viewer (`Drive.Permissions.create`), and the toast reads "Google Sheet created, shared with you." with an Open Sheet link that opens for the viewer. As the owner the toast reads "Google Sheet created." (no self-share). If any of the three calls is refused under drive.file, the documented fallback in the architecture spec (risks section) applies: swap `drive.file` for the full `spreadsheets` scope and use `SpreadsheetApp.create`, keeping the read-only enforcement by code and static scans. That widens the grant to write the source Sheet, so the owner must accept it explicitly; do not apply it silently. CSV and Excel exports work either way.
- [ ] The sixth Sheet export in ten minutes is refused with the rate message.

Access
- [ ] A non-domain account (personal Gmail) opening the `/exec` URL gets the denied page, with no register data in the response and no stack trace.
- [ ] A domain account not on the list sees the denied page in list mode, with the owner named.
- [ ] Org-mode admission: the owner switches Access to "Anyone in the organisation" (the confirmation names the domain); a same-domain account not on the list is admitted as a viewer, sees no admin actions, and cannot reach admin or owner endpoints; switching back to list mode refuses them again.
- [ ] An admin (added by the owner) can change rules, fields, display and the people list, but cannot change the mode, the Admins list or the source Sheet, and sees no Probe button.
- [ ] The source Sheet is unchanged after all of the above (version history shows no edit by the deployer or anyone through CCCP).

Rollback
- [ ] `clasp deploy -i <DEPLOYMENT_ID> -V <previous version>` restores the previous release and `deploymentDiagnostic` is still clean.
