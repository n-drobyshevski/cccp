// The kit contracts (src/kit/tooling/src/test/contracts), registered against this app. Each one is
// a spec factory that fails on drift. The app's client kernel and cache are still its own (the
// kit swaps are later work packages), so a contract that needs a kit shape the app does not have
// yet is deferred at the bottom, with the work package that brings it. None is registered with
// weakened options to force a pass.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as endpointsClassified from "@gas-kit/tooling/test/contracts/endpointsClassified.js";
import * as entryParity from "@gas-kit/tooling/test/contracts/entryParity.js";
import * as guardsPass from "@gas-kit/tooling/test/contracts/guardsPass.js";
import * as manifestScopes from "@gas-kit/tooling/test/contracts/manifestScopes.js";
import * as manifestWebapp from "@gas-kit/tooling/test/contracts/manifestWebapp.js";
import * as noColourOutsideTokens from "@gas-kit/tooling/test/contracts/noColourOutsideTokens.js";
import * as noDangerousServerApis from "@gas-kit/tooling/test/contracts/noDangerousServerApis.js";
import * as noMutators from "@gas-kit/tooling/test/contracts/noMutators.js";
import * as noRaw from "@gas-kit/tooling/test/contracts/noRaw.js";
import * as noSecrets from "@gas-kit/tooling/test/contracts/noSecrets.js";
import * as noTitleAttr from "@gas-kit/tooling/test/contracts/noTitleAttr.js";
import * as noUserProperties from "@gas-kit/tooling/test/contracts/noUserProperties.js";
import * as roleMatrix from "@gas-kit/tooling/test/contracts/roleMatrix.js";
import * as runNames from "@gas-kit/tooling/test/contracts/runNames.js";
import * as viewerFreeCore from "@gas-kit/tooling/test/contracts/viewerFreeCore.js";
import * as cacheNamespaces from "@gas-kit/tooling/test/contracts/cacheNamespaces.js";
import * as scrubClean from "@gas-kit/tooling/test/contracts/scrubClean.js";
import { isPushRun } from "@gas-kit/tooling/build/push.mjs";
import config from "../app.config.mjs";
import { __resetMemosForTest } from "../src/server/access";
import * as api from "../src/server/api";
import * as server from "../src/server/index";
import { ENDPOINT_ROLES } from "../src/server/roles";
import { cache, coreKey } from "../src/server/serverCache";
import { useGasEnv } from "./gasEnv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const read = (p: string) => readFileSync(p, "utf8");
const apiTs = read(join(SRC, "server/api.ts"));
const entryJs = read(join(SRC, "gas/entry.js"));

// The app's own code. src/kit is the vendored kit (hash-locked) and src/vendor is verbatim
// sidekick code (pinned by tools/vendor.lock.json, replaced by a later work package): neither is
// scanned by the app's contracts.
const APP_DIRS = ["server", "client", "domain", "gas"].map((d) => join(SRC, d));

// Globals entry.js defines besides the api_ delegators: not RPCs. include is gated by denyResult;
// setup and deploymentDiagnostic by assertOwner; refreshRegister by the trigger check.
const ALLOWED_GLOBALS = ["doGet", "include", "setup", "deploymentDiagnostic"];

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (name === "kit" || name === "vendor" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

describe("every RPC is classified twice", () => {
  endpointsClassified.register(describe, it, expect, { apiTs, rolesTable: ENDPOINT_ROLES });
  entryParity.register(describe, it, expect, { apiTs, entryJs, allowFunctions: ALLOWED_GLOBALS });
  runNames.register(describe, it, expect, { apiPath: join(SRC, "server/api.ts") });
  it("lists exactly the exports of the api module", () => {
    expect(Object.keys(ENDPOINT_ROLES).sort()).toEqual(Object.keys(api).sort());
  });
});

describe("the role matrix", () => {
  // Every endpoint, through src/gas/entry.js loaded in a vm over the app's real server bundle
  // namespace, as five identities. cccp's own test/server/roleMatrix.test.ts keeps the checks the
  // contract does not make (an allowed call never reaches a source write, the admin sheetId patch,
  // org mode).
  const fakes = useGasEnv({ workbook: true, seed: true });
  const ALL = ["owner", "admin", "viewer"];
  const ADMINS = ["owner", "admin"];
  const VIEW = { name: "Matrix", scope: "shared", route: "list", state: { q: "", f: {}, sort: "n", cols: [], metric: "worst" } };
  // Parameters change nothing that a later identity depends on: the lists and the settings are saved as they are.
  const endpoints = {
    bootstrap: { allowed: ALL },
    getRegister: { allowed: ALL },
    getAccess: { allowed: ALL },
    exportToSheet: { allowed: ALL, params: { ids: [], columns: [], title: "x" } },
    getSettings: { allowed: ADMINS },
    saveSettings: { allowed: ADMINS, params: { patch: { display: { theme: "dark" } }, baseGen: 0 } },
    reloadData: { allowed: ADMINS },
    saveSharedView: { allowed: ADMINS, params: { view: VIEW } },
    deleteSharedView: { allowed: ADMINS, params: { id: "nothere" } },
    saveAccess: { allowed: ADMINS, params: { users: "viewer@example.com" } },
    getDiagnostics: { allowed: ADMINS },
    saveAdmins: { allowed: ["owner"], params: { admins: "admin@example.com" } },
    saveAccessMode: { allowed: ["owner"], params: { mode: "list" } },
    probeSource: { allowed: ["owner"], params: { url: "" } },
  };
  const as = (email: string) => { __resetMemosForTest(); fakes().setActiveUser(email); };
  const who = (label: string, email: string) => ({ label, setup: () => as(email) });
  // The Script Properties and the script cache, compared before and after a refused call.
  const state = () => {
    const s = fakes().snapshot();
    return roleMatrix.storeState({ props: s.props, cache: s.cache });
  };
  const loadEntry = (): Record<string, (...a: unknown[]) => unknown> => {
    const ctx = vm.createContext({ Server: server, console, Date, JSON });
    vm.runInContext(entryJs, ctx, { filename: "entry.js" });
    return ctx as never;
  };
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  roleMatrix.register(describe, it, expect, {
    server: loadEntry(),
    state,
    // Before each identity the register is cached (a bootstrap as the owner), so a refused call
    // that drops the cache shows.
    prepare: () => { as("owner@example.com"); api.bootstrap(); },
    identities: [who("owner", "owner@example.com"), who("admin", "admin@example.com"), who("viewer", "viewer@example.com"), who("stranger", "stranger@elsewhere.org"), who("anonymous", "")],
    expect: endpoints,
    rolesTable: ENDPOINT_ROLES,
    roleIdentities: { viewer: ["owner", "admin", "viewer"], admin: ["owner", "admin"], owner: ["owner"] },
    // Through the real delegator, so the access check in timedApi_ is part of what is checked.
    call: (s: Record<string, (p: unknown) => unknown>, name: string, params: unknown) => s["api_" + name]!(params),
  });
});

describe("every public global refuses a stranger at run time", () => {
  // The runtime form of entryParity: each global entry.js defines without a trailing underscore is
  // called as a signed-in caller on no list, as google.script.run would, and must refuse (throw,
  // answer nothing or the forbidden envelope; doGet answers its denial page) without changing the
  // Script Properties or the cache.
  const fakes = useGasEnv({ workbook: true, seed: true });
  it("refuses with each global", async () => {
    const ctx = vm.createContext({ Server: server, console: { log() {}, error() {}, warn() {} }, Date, JSON });
    vm.runInContext(entryJs, ctx, { filename: "entry.js" });
    const v = await entryParity.probeGlobals({
      globals: ctx as never,
      entryJs,
      asStranger: () => { __resetMemosForTest(); fakes().setActiveUser("stranger@elsewhere.org"); },
      refusals: { doGet: (r: any) => !!r && typeof r.getContent === "function" && /have access to this app/.test(String(r.getContent())) },
      state: () => { const s = fakes().snapshot(); return roleMatrix.storeState({ props: s.props, cache: s.cache }); },
    });
    expect(v).toEqual([]);
  });
});

describe("the manifest asks for the scopes the code needs", () => {
  const manifest = JSON.parse(read(join(SRC, "gas/appsscript.json")));
  // The full spreadsheets scope is a reviewed decision: SpreadsheetApp.openById refuses
  // spreadsheets.readonly, and the source stays read-only by code (the noMutators contract below).
  // src/kit/server is bundled into the deployed server and is what calls Session and ScriptApp now,
  // so it is scanned too (it sits right under SRC).
  manifestScopes.register(describe, it, expect, { manifest, srcDir: [SRC], allowBroad: ["https://www.googleapis.com/auth/spreadsheets"] });
  manifestWebapp.register(describe, it, expect, { manifestPath: join(SRC, "gas/appsscript.json"), access: config.webappAccess });
  it("app.config.mjs lists exactly the manifest's scopes and zone", () => {
    expect([...config.oauthScopes].sort()).toEqual([...manifest.oauthScopes].sort());
    expect(config.timeZone).toBe(manifest.timeZone);
  });
});

describe("no dangerous server API", () => {
  // No allow entries: the app's own server code no longer reads the caller's identity (Session) or
  // builds HTML (the kit's access and page modules do, and the contract's own allow list for the
  // kit covers them), and it reads no file from HtmlService (the kit's include does).
  noDangerousServerApis.register(describe, it, expect, { srcDir: join(SRC, "server") });
});

describe("no secret in the sources or the build", () => {
  noSecrets.register(describe, it, expect, { dirs: [APP_DIRS[0]!, APP_DIRS[1]!, APP_DIRS[2]!, APP_DIRS[3]!, DIST], root: ROOT });
});

describe("no unreviewed raw()", () => {
  // The same list as rawAllowed in eslint.config.js; each entry is a reviewed use with its reason.
  noRaw.register(describe, it, expect, {
    dirs: [join(SRC, "client")],
    allow: {
      "lib/icons.js": "wraps the static, hard-coded SVG markup of the icon set; no interpolated data",
      "components/table.js": "raw(icon): the output of icons.js, a static SVG in a header cell",
      "shell/appbar.js": "raw(' aria-current=...'): a constant attribute fragment, no data",
    },
  });
});

describe("no colour outside the tokens", () => {
  noColourOutsideTokens.register(describe, it, expect, {
    cssFiles: walk(join(SRC, "client"), [".css"]),
    jsFiles: walk(join(SRC, "client"), [".js"]),
    allow: ["src/client/styles/tokens.css"],
  });
});

describe("no title attribute", () => {
  noTitleAttr.register(describe, it, expect, {
    files: [...walk(join(SRC, "client"), [".js", ".html"]), ...walk(join(SRC, "server"), [".ts"]), join(SRC, "gas/entry.js")],
  });
});

describe("the source is read-only", () => {
  // Only sourceSheet.ts opens the register Sheet; only exportSheet.ts writes (a new file it makes).
  noMutators.register(describe, it, expect, {
    srcDir: join(SRC, "server"),
    allow: ["exportSheet.ts"],
    confineAdvanced: ["exportSheet.ts"],
  });
});

describe("no per-user store", () => {
  noUserProperties.register(describe, it, expect, { srcDir: APP_DIRS });
});

describe("the built files pass the build guards", () => {
  // npm run push builds first and runs this suite with GAS_KIT_PUSH=1, so these guards check the
  // bundle that is pushed. In a push run a missing dist fails; a plain test run skips.
  if (existsSync(join(DIST, "js_app.html"))) {
    guardsPass.register(describe, it, expect, { distDir: DIST });
    entryParity.registerDist(describe, it, expect, { distDir: DIST, apiTs, allowFunctions: ALLOWED_GLOBALS });
    noTitleAttr.register(describe, it, expect, { files: walk(DIST, [".html", ".js"]) });
  } else if (isPushRun()) {
    it("guards on dist: dist/ must exist in a push run", () => {
      expect.fail("dist/js_app.html is absent in a push run (GAS_KIT_PUSH=1): the build must run before the tests");
    });
  } else {
    it.skip("guards on dist: dist/ is absent, run npm run build first", () => {});
  }
});

describe("no private term", () => {
  // TODO(owner): put the names that must never appear here (an employer, an internal host, a
  // deployment id). The pattern below is a placeholder that matches nothing real. Scanning only
  // the app's own files: the vendored trees are pinned elsewhere.
  scrubClean.register(describe, it, expect, { root: ROOT, extraTerms: [/zz-private-term-placeholder/i], allow: ["contracts.test.ts"] });
});

describe("the cached core is viewer-free", () => {
  // The core as it sits in the script cache (not the response), after a bootstrap as a plain
  // viewer: nothing per viewer at any depth. cccp's own allowlist and address scan stay in
  // test/server/bootstrap.test.ts.
  const fakes = useGasEnv({ workbook: true, seed: true });
  let core: unknown;
  beforeEach(() => {
    __resetMemosForTest();
    fakes().setActiveUser("viewer@example.com");
    api.bootstrap();
    core = cache.peek("core1", coreKey());
  });
  viewerFreeCore.register(describe, it, expect, { get core() { return core; } } as never);
});

describe("cache namespaces are versioned", () => {
  // register1 and core1 (the kit's createCache in src/server/serverCache.ts), headers1.
  cacheNamespaces.register(describe, it, expect, { srcDir: join(SRC, "server"), minHits: 4 });
});

// DEFERRED contract (not registered):
//  - confidential    (C2g: diagnostics and setup) needs DATA_CLASS in src/server/config.ts and the
//                    kit's policy object; app.config.mjs already says dataClass "confidential".
