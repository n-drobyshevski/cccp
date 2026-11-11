/**
 * src/gas/entry.js: the GAS globals, hand-written and copied to dist/ by the build.
 *
 * esbuild bundles src/server into dist/server.js as an IIFE assigned to the global `Server`.
 * Apps Script can only call top-level functions, so every callable surface needs a thin
 * global here that delegates into that namespace. This file is not generated:
 * test/build/entryPoints.test.js and the build's drift guard hold it in step with
 * src/server/api.ts, because a missing delegator fails silently and only in production.
 *
 * Derived from sidekick gas_hub/dist/entry.js at commit 77bcf22 (see VENDOR.md).
 */

/** The web-app entry. Refuses before it draws. There is no welcome gate. */
function doGet(e) {
  var denied = Server.access.deniedPage();
  if (denied) return denied;
  return Server.doGet(e);
}

/**
 * Used by the include scriptlets in index.html. Gated: as a top-level global it would
 * otherwise be an open file-read primitive.
 */
function include(filename) {
  return Server.access.denyResult("include") ? "" : Server.include(filename);
}

/**
 * The one chokepoint every RPC passes through: check access, time the call, log the timing.
 * The {ok, data} envelope is built in api.ts, so the dev harness and the deployment agree.
 */
function timedApi_(name, params) {
  var denied = Server.access.denyResult(name);
  if (denied) return denied;
  var t0 = Date.now();
  var res = Server.api[name](params || {});
  console.log(JSON.stringify({ api: name, ms: Date.now() - t0 }));
  return res;
}

/* ----------------------------------------------------------------- RPC delegators */
/* One per export in src/server/api.ts, in that file's order. */

function api_bootstrap(p) { return timedApi_("bootstrap", p); }
