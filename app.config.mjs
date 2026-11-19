// The app's one configuration file, read by the build (tools/build.mjs), the dev tooling and the
// kit contracts in test/contracts.test.ts.
import { APP_ROOT, kitAliases } from "./tools/kitPaths.mjs";

export default {
  name: "cccp",
  // Shown in the header and the browser tab.
  product: "CCCP",
  // Every localStorage key of this app starts with it.
  storagePrefix: "cccp.",
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
    // The vendored settingsForm contract asserts a specifier of the form '<dots>/gas_shared/ui/
    // settingsForm.js', so the settings draft imports it as 'gas_shared/ui/...'. Goes when
    // src/vendor does.
    alias: { ...kitAliases(APP_ROOT), gas_shared: "src/vendor/gas_shared" },
    // Byte caps for the bundles every page inlines: the build fails above them, so growth is a
    // decision. Baseline before the kit build: server 119292, js 181890, css 59220. The kit build
    // targets es2017 for the client (was es2019) and stamps the server banner differently, so the
    // first kit build is server 119317, js 182599, css 59220; the caps sit just above those.
    // C2a: the server cap rises to 126100 (bundle 125931); C2b: 130400 (bundle 130204, the kit run and role gate); C2d: 140900 (bundle 140748, the kit cache with its checksummed head record and per-execution memory replaces the app's 5 KB chunking cache; sha1 stays until sharedViews/exportSheet move); C2c: 136400 (bundle 136216, the kit access
    // object and card page, 8 KB and 3 KB, against the app's 4.3 KB access module and 2.1 KB page shell). The kit's props, lock, error log, boot and
    // page modules replace the app's smaller copies and the kit barrel keeps a few of its module-level
    // tables (policy, audit) that nothing here calls; the cap drops again as the app's own kernel
    // files are deleted in the next work packages.
    budgets: { server: 140_900, js: 183_000, css: 59_300 },
  },
};
