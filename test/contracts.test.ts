// The kit contracts (src/kit/tooling/src/test/contracts), registered against this app. Each one is
// a spec factory that fails on drift. The app's server and client kernels are still its own (the
// kit swaps are later work packages), so the contracts that need the kit's server shape are
// deferred below, each with the work package that brings the shape. None is registered with
// weakened options to force a pass.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { expect, it } from "vitest";
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
import * as scrubClean from "@gas-kit/tooling/test/contracts/scrubClean.js";
import { isPushRun } from "@gas-kit/tooling/build/push.mjs";
import config from "../app.config.mjs";
import { ENDPOINT_ROLES } from "../src/server/roles";

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
});

describe("the manifest asks for the scopes the code needs", () => {
  const manifest = JSON.parse(read(join(SRC, "gas/appsscript.json")));
  // The full spreadsheets scope is a reviewed decision: SpreadsheetApp.openById refuses
  // spreadsheets.readonly, and the source stays read-only by code (the noMutators contract below).
  manifestScopes.register(describe, it, expect, { manifest, srcDir: APP_DIRS, allowBroad: ["https://www.googleapis.com/auth/spreadsheets"] });
  manifestWebapp.register(describe, it, expect, { manifestPath: join(SRC, "gas/appsscript.json"), access: config.webappAccess });
  it("app.config.mjs lists exactly the manifest's scopes and zone", () => {
    expect([...config.oauthScopes].sort()).toEqual([...manifest.oauthScopes].sort());
    expect(config.timeZone).toBe(manifest.timeZone);
  });
});

describe("no dangerous server API", () => {
  // Reviewed uses, each with its reason:
  //  session:     access.ts is the app's access module, the one place that reads the caller's identity.
  //  htmlAppend:  access.ts deniedPage() builds the denial page; every interpolation goes through
  //               escapeHtml (deniedHtml), and it names no roster.
  noDangerousServerApis.register(describe, it, expect, {
    srcDir: join(SRC, "server"),
    allow: { session: ["access.ts"], htmlAppend: ["access.ts"] },
  });
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

// DEFERRED contracts (not registered; they need the kit's server shape, and cccp's server is
// still its own):
//  - runNames        (C2b: run/roles) expects `run` from the kit's createRun in api.ts, each body
//                    exactly `return run("<own name>", () => ...)`.
//  - roleMatrix      (C2b: run/roles) drives the kit's envelope through timedApi_; cccp's own
//                    test/server/roleMatrix.test.ts keeps the matrix until then. Also covers the
//                    run-time form of entryParity (probeGlobals).
//  - cacheNamespaces (C2d: cache) expects namespaces created by the kit's createCache, versioned
//                    letters-then-number.
//  - viewerFreeCore  (C2d: cache / bootstrap) needs the kit's cached core; cccp's own
//                    viewer-free test stays until then.
//  - confidential    (C2a: server config/policy) needs DATA_CLASS in src/server/config.ts and the
//                    kit's policy object; app.config.mjs already says dataClass "confidential".
