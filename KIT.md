# KIT.md: the gas-kit this app is built on

CCCP takes its shared code from gas-kit, copied into `src/kit/` and pinned by `kit.lock.json`
(kit `0.1.0`, commit `a9f8834e0581c96ced61bfcc860a92a59be6870e`, a local checkout). Nothing under
`src/kit` is edited here. Until C6 the app also carried a verbatim snapshot of an earlier shared
library (`src/vendor`, pinned at its commit `77bcf22`, taken from the `sidekick` repository, with
`vendor:sync`, `vendor:verify` and `vendor:diff` scripts). The kit replaced every file of it, the
last ones in C5d, and C6 deleted it with its lock, its tooling and its test. This file is the only
place those names still appear, as history.

## Taking a newer kit

```
npm run kit:diff -- --from <kit checkout>     # what would change; read it before taking it
npm run kit:sync -- --from <kit checkout>     # copies the kit's files and rewrites kit.lock.json
npm run kit:verify                            # src/kit against kit.lock.json, and imports stay inside the kit
npm run check                                 # then the app's own tests and the budgets
```

`kit:verify` is the last step of `npm run check`. `kit:sync` also takes `--ref <branch | tag |
commit>` and a git URL; `kit:diff --exit-code` fails when the two differ. After a sync, read the
kit's changelog, run the whole e2e suite (the pixel baselines catch a changed component) and raise
`build.budgets` in `app.config.mjs` only with the new size named in the comment beside it.

## App-owned on purpose

These pieces do not use the kit, each for a reason that still holds. A kit change that removes the
reason is the cue to adopt it.

| piece | why it stays app-owned |
| --- | --- |
| `src/server/sourceSheet.ts` | the single file that calls `SpreadsheetApp`; the kit's `sheetSource` reads one tab per open, CCCP reads up to five tabs from one open, detects the Applications tab by header and probes tabs with gid and row counts, and the source `title`, `url` and `gid` are needed for the single-open read |
| `src/server/sharedViews.ts` | its own store (VIEWS_GEN, a list, not sections), so it is not the kit settings store |
| `src/server/exportSheet.ts` (the RPC around the kit's `createSheetExport`) | the kit leaves the "sheet" export, its throttle key policy and its sentences to the app |
| `src/client/state/url.js`, `shell/router.js` | the query string over the google.script bridge (`?r=`, `?app=`, filters), not the kit's hash helpers |
| `src/client/shell/splash.js` | the boot-steps view with its stages, not the kit's `hideSplash` |
| pre-paint theme script in `index.html` | defaults to light (the kit script is used with `default: "light"`, pinned by a test) |
| `src/client/lib/storage.js` | a thin wrapper over the kit's `createStorage("cccp.")` that keeps `theme` and `fs.side` as bare strings, which the pre-paint script and older builds read |
| `src/client/lib/icons.js` | one icon the kit lacks (the bang mark of the Attention glyph) |
| `src/client/components/table.js` | the Identity G inventory table: Status is four header and body cells (CY CO CT PL in the pillar colours) behind one sort, no count line, the name is a button with `data-k="open-<id>"`; the kit `dataTable` has one cell per column, a caption, a scroller region and a count line. It does use the kit `tableModel` (sort, column choice, Show more) |
| `components/dots.js`, `glyph.js`, `legend.js` | the approved round status dots and glyphs with a dashed "none"; they differ from the kit's `statusDot` shapes. They use only kit token names |
| `components/stackBar.js` | the kit `stackBar` is a focusable group (tabindex 0), and each pillar bar sits inside the pillar button, where a focusable descendant is invalid and adds a second tab stop |
| `components/viewList.js`, `facetPanel.js` | saved views and the filters panel (sections, Clear, "+ N more"); no kit equivalent. The facet rows inside are the kit `facetList` |
| pillar cells and the Overview domains table | glyph per pillar, gap counts as buttons; app markup over the kit tokens |
| `pages/settings/*` tabs (Display, Fields, Source, Rules) and `formKernel.js` | segmented controls, tables and nested rule cards; the kit `settingsForm` is a flat field schema. The draft kernel is derived (below); the savebar, switch, `guardUnsaved` and `sameValue` are the kit's |
| `pages/settings/access.js` view | the mode is the owner's own `saveAccessMode` call that names its effect first; the kit `accessEditor` keeps the mode in the draft and does not confirm. The draft itself is the kit `accessModel` |
| settings savebar extras (tab links, rule notes beside the bar) | the kit `savebar` has no slot for them (a kit gap) |
| the Sheet export item (`components/exportMenu.js`), the gap and "No tier" dots on facet rows | the kit `runExport` leaves "sheet" to the app; the dots are drawn by the app's CSS over the kit facet rows, which have no slot |
| `dev/serve.mjs`, `dev/boot.js`, `dev/gas-shims.js` | the dev server with fake Sheets, Drive and Script Properties (derived, below) |

## Derived files

Written by hand in this repo from an upstream app; they are not byte-pinned and carry a provenance
header. A derived file that is not in this table is a defect. "Upstream" is the earlier shared
library and apps this project started from (commit `77bcf22`).

| file here | derived from | changes |
| --- | --- | --- |
| `src/domain/codec.ts` | upstream `gas_shared/domain/snapshotCodec.ts` (the row codec only) | formerly vendored verbatim, app-owned since C6; the wire format is unchanged, so a cached register still decodes; its tests are `test/domain/codec.test.ts` |
| `src/client/pages/settings/formKernel.js` | upstream `gas_shared/ui/settingsForm.js` | formerly vendored, app-owned since C5c; the leaf comparison is the kit's `sameValue`; contract in `test/client/formKernel.test.js` |
| `src/server/api.ts` | upstream hub `api.ts` | pattern only: every body is `return run(name, ...)` with the kit's `run`; the CCCP endpoints |
| `src/gas/entry.js`, `src/gas/appsscript.json` | upstream hub `dist/entry.js`, `appsscript.json` | CCCP delegators; gated `setup()` and `deploymentDiagnostic()`; four scopes; Sheets v4 and Drive v3 advanced services |
| `src/server/serverCache.ts` | upstream ai app `serverCache.ts` | pattern only since C2d: the kit's `createCache` with the three version counters in the keys |
| `src/server/bootstrap.ts` | upstream devsecops `bootCore.ts` | pattern only: a cached viewer-free core plus live fields, with a key allowlist test |
| `dev/serve.mjs`, `dev/boot.js`, `dev/gas-shims.js` | upstream hub and ledger dev files | port 8791; read-only SpreadsheetApp fake; Sheets and Drive fakes; flags as, mode, admins, nosource, empty, coldcache, slow, tz |
| `src/client/components/facetList.js`, `src/client/state/views.js` | upstream ai app `filters.js`, `savedViews.js` | pattern only |
| `test/server/access*.test.ts`, `test/client/accessModel.test.js`, `test/build/{entryPoints,manifestScopes}.test.js` | upstream access and manifest tests | paths updated; org-mode, owner-only and exact-scope cases added |

`src/server/access.ts`, `main.ts` and `index.ts` are thin wiring over the kit (`createAccess`, props, lock, error log,
`renderIndex`, `cardPage`); they are no longer derived from anything.

## Rolling back to a pre-kit build

Since C2c the access lists (`ALLOWED_USERS`, `ALLOWED_ADMINS`) are stored as JSON arrays. A build
from before the migration splits them on commas and spaces, so it reads `["a@example.org"` and
fails closed: only the owner gets in. After such a rollback the owner re-saves both lists in
Settings, Access (or runs `setup()`), which rewrites them in the old delimited form. The cache
epoch (4 since C2d) and every other stored value read the same in both directions.
