// The kit-shaped profile: an app that already follows the kit's layout (src/gas, src/server,
// src/client with lib helpers and the html template, src/domain, roles.ts, a vendored tree). detect
// scores the evidence; steps lists the profile's own steps (steps/<run>.mjs). They all run before
// rpc-surface: carry-roles must, since rpc-surface applies the roles it carries. The two parts that
// need rpc-surface's endpoint names and the routes step's routes.js are spawned at run time as tool
// steps that wait for them: server-endpoints (by server-map) and page-routes (by copy-pages).
import { keysUnder, makeStep, moved } from "../maps.mjs";

export const name = "kit-shaped";

/**
 * @param {import("../sourceTree.mjs").SourceTree} tree
 * @param {import("../schema.mjs").Inventory} [_inv]
 * @returns {{ score: number, evidence: string[] }}
 */
export function detect(tree, _inv) {
  let score = 0;
  /** @type {string[]} */
  const evidence = [];
  /** @param {number} n @param {string} why */
  const hit = (n, why) => {
    score += n;
    evidence.push(why);
  };
  /** @param {string} key */
  const text = (key) => (tree.files.has(key) ? tree.read(key) : "");
  if (tree.files.has("src/client/lib/html.js")) hit(15, "src/client/lib/html.js (the html template)");
  if (/\brenderRegion\b/.test(text("src/client/lib/dom.js"))) hit(10, "src/client/lib/dom.js exports renderRegion");
  if (/\bENDPOINT_ROLES\b/.test(text("src/server/roles.ts"))) hit(20, "src/server/roles.ts holds ENDPOINT_ROLES");
  const entry = text("src/gas/entry.js");
  if (/\bfunction\s+api_\w+/.test(entry)) hit(15, "src/gas/entry.js has api_ delegators");
  if (/\btimedApi_\b/.test(entry)) hit(5, "src/gas/entry.js goes through timedApi_");
  if ([...tree.files.keys()].some((k) => k.startsWith("src/domain/"))) hit(10, "src/domain/ exists");
  if (tree.files.has("tools/vendor.lock.json") || [...tree.files.keys()].some((k) => k.startsWith("src/vendor/"))) hit(10, "a vendored tree (src/vendor, tools/vendor.lock.json)");
  const pages = [...tree.files.keys()].filter((k) => k.startsWith("src/client/pages/"));
  if (pages.some((k) => /\bhtml\s*`/.test(text(k)))) hit(10, "pages are html template functions");
  return { score: Math.min(100, score), evidence };
}

/**
 * Where a ported test goes: a .js test (browser code, checked as JavaScript) under
 * test/client/migrated, which the target's client test tsconfig (DOM lib) covers; a .ts or .mjs
 * test under test/migrated (the server tsconfig, no DOM).
 * @param {string} key
 */
export function portedTestPath(key) {
  const base = key.split("/").pop() ?? key;
  return /\.js$/.test(base) ? "test/client/migrated/" + base : "test/migrated/" + base;
}

/**
 * @param {import("../schema.mjs").Inventory} inv
 * @param {{ fidelity?: string }} [_opts]
 * @returns {import("../schema.mjs").Step[]}
 */
export function steps(inv, _opts) {
  const domain = keysUnder(inv, "src/domain/", ["js", "ts"]);
  const serverJs = keysUnder(inv, "src/server/", ["ts", "js"]);
  const vendor = [...keysUnder(inv, "src/vendor/"), ...keysUnder(inv, "tools/vendor.lock.json")];
  const pages = [...keysUnder(inv, "src/client/pages/", ["js"]), ...keysUnder(inv, "src/client/state/", ["js"]), ...keysUnder(inv, "src/client/main.js")];
  const libs = keysUnder(inv, "src/client/lib/", ["js"]);
  const tests = inv.files.filter((f) => /(?:^|\/)test\//.test(f.key) || /\.(?:test|spec)\./.test(f.key)).map((f) => f.key);
  return [
    makeStep({
      id: "copy-domain", kind: "tool", run: "copyDomain", title: "Copy the domain code verbatim into src/domain/app",
      files: { reads: domain, writes: moved(domain, "src/domain/", "src/domain/app/") },
    }),
    makeStep({
      id: "kit-imports", kind: "tool", run: "kitImports", title: "Point lib imports at the kit modules whose exports fit",
      after: ["copy-domain"],
      files: { reads: libs, writes: moved(libs, "src/client/", "src/client/migrated/") },
    }),
    makeStep({
      id: "server-map", kind: "tool", run: "serverMap", title: "Map the server modules onto the kit server kernel",
      after: ["kit-imports"],
      files: { reads: serverJs, writes: moved(serverJs.filter((k) => !/^src\/server\/(?:api|roles|index|main)\.ts$/.test(k)), "src/server/", "src/server/app/") },
    }),
    makeStep({
      id: "carry-roles", kind: "tool", run: "carryRoles", title: "Carry ENDPOINT_ROLES; an unknown role becomes owner",
      after: ["server-map"],
      files: { reads: ["src/server/roles.ts", "src/gas/entry.js"].filter((k) => inv.files.some((f) => f.key === k)), writes: [] },
    }),
    makeStep({
      id: "vendor-carry", kind: "tool", run: "vendorCarry", title: "Copy src/vendor and its lock",
      after: ["carry-roles"],
      files: { reads: vendor, writes: [...vendor.filter((k) => k.startsWith("src/vendor/")), ...(vendor.includes("tools/vendor.lock.json") ? [".migrate/vendor.lock.json"] : [])] },
    }),
    makeStep({
      id: "copy-pages", kind: "tool", run: "copyPages", title: "Batch-copy the pages and the client entry",
      after: ["vendor-carry"],
      files: { reads: pages, writes: moved(pages, "src/client/", "src/client/migrated/") },
    }),
    makeStep({
      id: "reconcile-modules", kind: "agent", title: "Reconcile the modules whose exports drifted from the kit's",
      after: ["copy-pages"],
      files: { reads: libs, writes: moved(libs, "src/client/", "src/client/migrated/") },
    }),
    makeStep({
      id: "port-tests", kind: "agent", title: "Port the app's tests onto the target (browser tests under test/client/migrated, the rest under test/migrated)",
      after: ["reconcile-modules"],
      files: { reads: tests, writes: tests.map((k) => portedTestPath(k)) },
    }),
  ];
}
