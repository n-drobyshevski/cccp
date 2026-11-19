// The app's one configuration file, read by the build (tools/build.mjs), the dev tooling and the
// kit contracts in test/contracts.test.ts.
import { APP_ROOT, kitAliases } from "./tools/kitPaths.mjs";

export default {
  name: "cccp",
  // Shown in the header and the browser tab.
  product: "CCCP",
  // Every localStorage key of this app starts with it.
  storagePrefix: "cccp.",
  // The five brand tokens (the kit's brand contract), light and dark: Identity G's accent family.
  // tools/brandCss.mjs renders them into src/client/styles/brand.css (a test keeps the two in step).
  // The mark is the accent. Everything else of the theme is src/client/styles/theme.css.
  brand: {
    light: { accent: "#1a4f9c", accentInk: "#ffffff", accentSoft: "#eef3fb", mark: "#1a4f9c", markInk: "#ffffff" },
    dark: { accent: "#7fa8e6", accentInk: "#101418", accentSoft: "#1f2a3d", mark: "#7fa8e6", markInk: "#101418" },
  },
  // Must equal "timeZone" in src/gas/appsscript.json.
  timeZone: "Europe/Paris",
  // "webapp.access" in src/gas/appsscript.json must equal it (the manifestWebapp contract).
  webappAccess: "DOMAIN",
  // The access mode while ACCESS_MODE is unset (src/server/access.ts reads an unset mode as list).
  accessDefault: "list",
  // The register holds an inventory of applications with their cyber, compliance and continuity
  // gaps: an attacker's map, so it is treated as confidential, not merely internal. The kit's
  // "confidential" contract (list access only, owner pin, audit sheet, no inlined data) is NOT
  // registered yet: it needs the kit's server kernel (DATA_CLASS, policy), which a later work
  // package brings. Until then this value states the target and enforces nothing by itself.
  // C2g: the contract is still deferred (see the bottom of test/contracts.test.ts): the policy
  // behaviours the class turns on do not exist in this app yet.
  dataClass: "confidential",
  // A written reason for each POLICY_OVERRIDES key that weakens the policy (none yet).
  acceptedRisks: {},
  // The exact scopes src/gas/appsscript.json may ask for (copied from it; a contract pins the two).
  oauthScopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/script.scriptapp",
  ],
  // The appConfig of defineBuild (src/kit/tooling/src/build/defineBuild.mjs).
  build: {
    serverEntry: "src/server/index.ts",
    clientEntry: "src/client/main.js",
    cssEntry: "src/client/styles/index.css",
    alias: kitAliases(APP_ROOT),
    // Byte caps for the bundles every page inlines: the build fails above them, so growth is a
    // decision. Baseline before the kit build: server 119292, js 181890, css 59220. The kit build
    // targets es2017 for the client (was es2019) and stamps the server banner differently, so the
    // first kit build is server 119317, js 182599, css 59220; the caps sit just above those.
    // C2a: the server cap rises to 126100 (bundle 125931); C2b: 130400 (bundle 130204, the kit run and role gate); C2g: 157000 (bundle 156853, the kit diagnostics checks, scope and service-url checks, seedOwner and ensureDefaults replace the app's text formatter and seeding); C2f: 151200 (bundle 151074, the kit sheetExport with its flags, trash-on-failure and throttle replaces the app's export and throttle code and the vendored sha1); C2e: 148000 (bundle 147852, the kit settings store: sections, patch checks, authorize, gen bump; the app keeps its cleaning and sentences); C2d: 140900 (bundle 140748, the kit cache with its checksummed head record and per-execution memory replaces the app's 5 KB chunking cache; sha1 stays until sharedViews/exportSheet move); C2c: 136400 (bundle 136216, the kit access
    // object and card page, 8 KB and 3 KB, against the app's 4.3 KB access module and 2.1 KB page shell). The kit's props, lock, error log, boot and
    // page modules replace the app's smaller copies and the kit barrel keeps a few of its module-level
    // tables (policy, audit) that nothing here calls; the cap drops again as the app's own kernel
    // files are deleted in the next work packages.
    // C3a: the js cap rises to 196100 (bundle 195962, +13.3 KB): the kit html template scans every call site's
    // literal parts for the context of each interpolation (about 30 KB of source, 866 lines) and throws on
    // a value that does not fit, against the app's 37-line escape-only template; the app's own dom, format,
    // icons, csv, xlsx and zip files are gone, which gives back part of it.
    // C3b: the js cap rises again to 199900 (bundle 199794, +3.8 KB): the kit rpc (RpcError with ref and detail, busy
    // retry, boot payload), tip (hoverable card, watch for a replaced trigger, nested installs), theme and storage
    // modules are larger than the app's copies they replace; lib/storage.js keeps a thin wrapper for the bare-string
    // preferences and lib/errorText.js is new (the reference of an unexpected fault).
    // C4: the css cap rises to 66500 (bundle 66445, +7.1 KB): the kit's tokens.base.css (about 7 KB minified:
    // spacing, type, motion, chart, sidebar and shadow tokens the app does not use yet) now loads before theme.css.
    // C5a: js 208000 (bundle 207909, +8.0 KB: the kit toaster with its motion helpers, and the confirm island, replace
    // the app's 31 and 47 line modules) and css 72700 (bundle 72654, +6.2 KB: kit button, toast and confirm styles).
    // C5b: js 215700 (bundle 215603, +7.7 KB: kit exportMenu with runExport, dropdownMenu and columnChooser islands, facetList,
    // switch, tableModel helpers) and css 81400 (bundle 81361, +8.7 KB: kit dropdownMenu, columnChooser, facetList, exportMenu, kbd and
    // switch styles, plus the app's overrides); the app's popover, switch and checklist modules and styles are gone.
    // C5c: js 218900 (bundle 218797, +3.2 KB: the kit accessModel and savebar, the kit sameValue the settings kernel
    // now reads, a smaller access controller) and css 83000 (bundle 82880, +1.5 KB: kit savebar styles and the app's
    // overrides); the vendored accessModel, accessSave and settingsForm are no longer imported.
    // C5d: js 222100 (bundle 222012, +3.2 KB: the kit kpiTile with its count-up motion import and tags, the kit
    // tableModel that replaces the vendored one) and css 86200 (bundle 86135, +3.3 KB: kit kpiTile and tags styles
    // under the app's overrides). The server cap is unchanged (the kit tableModel is smaller than the vendored one).
    // C9 (kit 0.2.1): server 157900 (bundle 157823, +0.2 KB), js 228300 (bundle 228178, +6.1 KB: the kit's
    // table, dropdown, tabs, sheet and tip modules the app imports grew in 0.2) and css 86400 (bundle 86338,
    // +0.2 KB). No app code changed.
    budgets: { server: 157_900, js: 228_300, css: 86_400 },
  },
};
