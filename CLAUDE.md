# CLAUDE.md: binding rules for agents working in this repo

CCCP (Cyber, Compliance, Continuity, Platform) is a standalone Google Apps Script web app: a
view-only register of about 1,125 applications read from a Google Sheet. The approved design is
in the architecture spec; the approved UI is in `mockups/` (never edited, never bundled).

## Hard rules

- **The source is read-only.** The register Sheet is never written, by any code path. Only
  `src/server/sourceSheet.ts` (app code) and the kit's `sheetSource.ts` call `SpreadsheetApp`
  (`openById` only), and both return plain arrays. No app code calls the Sheets or Drive advanced
  services; the kit's `sheetExport.ts` does, and it writes only a new file. No mutator method
  names in `src/server`. Fakes in tests throw on any source write.
- **Every RPC is classified twice.** Each export of `src/server/api.ts` must be listed in
  `src/server/roles.ts` `ENDPOINT_ROLES` (viewer, admin or owner) and have a delegator in
  `src/gas/entry.js` that goes through `timedApi_`. `run()` checks the role before the body.
  A test fails on any unclassified export.
- **Never edit `src/kit`.** It is gas-kit, copied in and pinned by sha256 (`kit.lock.json`);
  `npm run kit:verify` (the last step of `check`) fails on any edit. Take a new kit only with
  `npm run kit:sync -- --from <kit checkout>` after reading `kit:diff`. A kit bug or gap is fixed
  in gas-kit and synced, never patched here; until then the app keeps its own piece and lists it in
  `KIT.md` with the reason. Kit rules (`/home/user/gas-kit/AGENTS.md`) bind the app too.
- **Nothing per-viewer goes in the core.** The cached bootstrap core and the cached register are
  viewer-free; viewer, role, email, serviceUrl and today live in the live part only. Never cache
  anything keyed by or containing a viewer. Do not use `UserProperties` (under USER_DEPLOYING it
  is the deployer's store). Personal data lives in `localStorage` keys prefixed `cccp.`.
- Prefer the kit: use a `@gas-kit/*` module or component wherever it fits, styled to the approved
  design with app CSS over kit classes. A piece that stays app-owned is listed in `KIT.md`.
- Never commit the real sample CSV or any copy of it. Tests that need it skip when it is absent.
- Commit per work package; push only to the session's development branch, never to `main`.
- Do not name any AI model in code, comments or commit messages, except the required commit
  trailer.

## Client rendering rules

- Views are pure functions returning `SafeHtml`, built with the `html` tagged template in
  `@gas-kit/client/html.js`, which escapes every interpolation. Raw markup needs an explicit,
  reviewed `raw()` call.
- Only `renderRegion(el, safe, {keepFocus, keepScroll})` in `@gas-kit/client/dom.js` (the kit; the app has no sink of its own) may assign
  `innerHTML`. `outerHTML` and `insertAdjacentHTML` are banned. ESLint enforces it. renderRegion
  restores focus by `data-k` and the scrollTop of `[data-keep-scroll]`.
- Events use delegation on `data-*` attributes: `delegate(root, 'click', '[data-act]', fn)`. No
  inline handlers.
- Tooltips are `data-tip`, shown on hover AND focus by the kit's `@gas-kit/client/tip.js` (`installTips`); the same text also appears
  in `aria-label` or visible text. `title` attributes are banned (ESLint and a static test).
- No literal double slash in any client string, regex, namespace or CSS `url()`: the Apps Script
  middlebox strips it and the build guard fails. URLs come from the server or are built with a
  join idiom such as `['https:', '', host].join('/')`.
- No backticks in the built client bundle (template literals are lowered); no `//` comment
  patterns that survive the build.
- No colour literals outside `src/client/styles/theme.css` (and the generated `brand.css`). Everything else uses tokens, in light
  and dark. Status is never shown by colour alone; the "none" dot is dashed. Focus ring is 2px
  `var(--accent)`.
- Dates from the server are `yyyy-MM-dd` strings already formatted in the sheet's timezone;
  clients never pass a date-only string to `new Date()`.
- `localStorage` access is always wrapped: on refusal it returns null and the control hides.
- Every filter, status and aggregate is computed in the browser over the whole register.

## Domain rules

- One shared pure TS tree, `src/domain`, is compiled into both bundles. Status rules live only in
  `src/domain/rules.ts`; there is no mirror. Tests are null-safe: unknown inputs never fire.
- Status is worst-wins per pillar; `why` is the first fired rule at the worst level, in catalogue
  order; with nothing fired the pillar's no-data predicate gives `none`, else `ok`.
- Script Property sections are refused above 8000 bytes. Settings saves are one
  `api_saveSettings({patch, baseGen})` call under the script lock; a stale baseGen is a conflict.
- Owner-only: saveAdmins, saveAccessMode, probeSource and any change to `source.sheetId`.

## Workflow

- `npm run check` (typecheck, lint, test, build tests, kit:verify) must be green before any
  commit; a UI change also needs `npm run e2e`, whose pixel baselines (`e2e/shots.spec.ts`) are
  never updated without reviewing the diff. Bundle budgets live in `app.config.mjs`; raise one
  only with the reason named beside it.
- Tests run with `TZ=UTC`; date suites also run under `TZ=Pacific/Kiritimati`.
- `dist/` is gitignored and built on push. Parallel work packages append to `api.ts`, `roles.ts`,
  `entry.js` and `index.css` in file order, to avoid merge conflicts.
- Commit message: `<WP id>: <title>`, a blank line, a short body, then the attribution lines
  required by the harness.
- Derived files carry a provenance header naming the upstream path and commit, and are listed in
  `KIT.md`.
