# VENDOR.md: provenance of code taken from sidekick

Source repository: `/home/user/sidekick` (read-only for this project), pinned at commit
`77bcf22`. Two kinds of file come from it.

- **Verbatim**: byte-identical copies under `src/vendor/<sidekick path>`. Never edited here.
  `tools/vendor.lock.json` records a sha256 per file; `npm run vendor:verify` and
  `test/build/vendor.test.js` fail on any difference, on a missing file, on a stray file under
  `src/vendor`, and on any import that leaves the vendored set (node builtins and other
  vendored files are the only allowed targets). The build stamp covers `src/vendor`.
- **Derived**: written by hand in this repo, with a provenance header naming the sidekick path
  and commit. They are not byte-pinned. After a sidekick security change, port it by hand.

## Re-sync recipe

1. See what changed upstream since the pin: `npm run vendor:diff -- --to <sha>`
   (prints a `git diff` of the vendored paths between `77bcf22` and `<sha>`).
2. Review the diff. Hand-port anything relevant to the derived files listed below.
3. Update the pin: `node tools/vendor.mjs sync --from /home/user/sidekick --commit <sha>`
   (rewrites exactly the locked files with `git show <sha>:<path>`, refreshes the lock, and
   exits non-zero without writing if a file would import outside the vendored set).
   Also change `--commit` in the `vendor:sync` script and the commit in this file.
4. `npm run check`. Contract tests and golden fixtures may churn; read the diffs.

To add a file to the verbatim set, add its sidekick path to `VENDOR_SET` in `tools/vendor.mjs`,
run sync, and list it below.

## Verbatim files (16)

| sidekick path (and path under `src/vendor/`) | Used for |
| --- | --- |
| `gas_shared/ui/settingsForm.js` | pure settings draft kernel; import by this direct path only |
| `gas_shared/ui/tableModel.js` | compareValues, nullsLast, sortRows, nextSort, column choice and its URL encoding |
| `gas_shared/ui/timing.js` | debounce, onPageTeardown, runPageTeardown |
| `gas_shared/ui/tipPlace.js` | tooltip and popover placement and delay maths |
| `gas_shared/ui/accessSave.js` | notKept, guardUnsaved |
| `gas_hub/src/client/js/pages/accessModel.js` | DOM-free access roster rules |
| `gas_shared/domain/csv.ts` | csvCell |
| `gas_shared/domain/sha1.ts` | sha1Hex |
| `gas_shared/domain/snapshotCodec.ts` | encodeRows / decodeRows for the register payload |
| `gas_shared/server/inlineBoot.ts` | inlineBootJson for the doGet bootstrap |
| `gas_shared/server/errorLog.ts` | ERROR_LOG ring buffer |
| `gas_shared/server/buildInfo.ts` | build id accessor |
| `gas_shared/build/buildStamp.mjs` | content hash of the build inputs (called with the repo root, so it covers `src/vendor`) |
| `gas_shared/build/deploy.mjs` | in-place deploy; needs `DEPLOYMENT_ID` |
| `gas_shared/test/contracts/settingsForm.js` | contract test for the settings draft module |
| `gas_shared/test/contracts/accessSave.js` | contract test for the access save module |

Not vendored on purpose: `gas_shared/server/dailyTrigger.ts` (the v2 seam for snapshots),
`gas_shared/build/whichBuild.mjs`, and everything in gas_shared's CSS, shell, `el()` and
dataTable.

## Derived files (provenance header in each; re-sync by hand-porting)

| file here | derived from (sidekick, `77bcf22`) | changes |
| --- | --- | --- |
| `src/server/access.ts` | `gas_hub/src/server/access.ts` | PRODUCT='CCCP'; `decide()` gains `modeRaw` (order: anonymous, owner, admin, listed, org, not-listed); parseAccessMode, accessMode, canEditSettings, canEditMode, canEditSource; welcome-gate prose dropped |
| `src/server/props.ts` | `gas_hub/src/server/props.ts` | CCCP `PROP_KEYS`; getJsonProp / putJsonProp with an 8000-byte cap |
| `src/server/pageShell.ts` | `gas_hub/src/server/pageShell.ts` | CCCP four-dot mark |
| `src/server/main.ts` | `gas_hub/src/server/main.ts` | title CCCP; `inlineBootJson(bootstrapInline)` |
| `src/server/index.ts` | `gas_hub/src/server/index.ts` | adds setup and diagnostics exports |
| `src/server/api.ts` | `gas_hub/src/server/api.ts` | keeps run(), logAccessChange, getAccess, saveAccess, saveAdmins; run() checks ENDPOINT_ROLES; errorKinds busy and conflict; URL endpoints dropped, CCCP endpoints added |
| `src/gas/entry.js`, `src/gas/appsscript.json` | `gas_hub/dist/entry.js`, `gas_hub/dist/appsscript.json` | CCCP delegators; gated setup() and deploymentDiagnostic(); scopes spreadsheets.readonly, drive.file, userinfo.email, script.scriptapp; Sheets v4 and Drive v3 advanced services |
| `build/esbuild.config.mjs`, `build/guards.mjs` | `gas_hub/esbuild.config.mjs` | guards split out for tests; index.html copied instead of generated; copies `src/gas/*` |
| `src/server/serverCache.ts` | `gas_ai/src/server/serverCache.ts` | wizDataVersion removed; configStamp becomes CFG_GEN; prefix `cccp`; ttl clamped 60..21600; sha1 from the vendored path |
| `src/server/bootstrap.ts` | `gas_devsecops/src/server/bootCore.ts` | pattern only: cached viewer-free core plus live fields, with a key allowlist test |
| `src/server/sourceSheet.ts` | `gas/src/server/sheetsDb.ts` (read half) | pattern only: no writers; dates formatted in the sheet's timezone |
| `dev/serve.mjs`, `dev/boot.js`, `dev/gas-shims.js` | `gas_hub/dev/{serve.mjs,boot.js,gas-shims.js}`, `gas/dev/gas-shims.js` | port 8791; read-only SpreadsheetApp fake; Sheets and Drive fakes; url/history shims; flags as, mode, admins, nosource, empty, coldcache, slow, tz |
| `src/client/lib/rpc.js` | `gas_shared/api.js` | keeps call() and the forbidden-envelope mapping; drops viewAs and previewRoute; adds an SWR cache with invalidate() |
| `src/client/lib/download.js` | `gas_shared/ui/dom.js` (downloadText only) | blob download with a BOM option and a Uint8Array variant; no el() |
| `src/client/components/facetList.js`, `src/client/state/views.js` | `gas_ai/src/client/js/{filters.js,savedViews.js}` | pattern only |
| `test/server/access*.test.ts`, `test/client/accessModel.test.js`, `test/build/{entryPoints,manifestScopes}.test.js` | `gas/test/access.test.ts`, `gas_hub/test/{accessAdmin.test.ts,accessModel.test.js,entryPoints.test.js,manifestScopes.test.js}` | paths updated; scoped-tier cases dropped; org-mode, owner-only and exact-scope cases added |

Derived files land in later work packages; this table is the contract for them. A derived
file that is not in this table is a defect.
