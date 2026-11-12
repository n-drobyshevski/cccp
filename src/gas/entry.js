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
function api_getRegister(p) { return timedApi_("getRegister", p); }
function api_getAccess(p) { return timedApi_("getAccess", p); }
function api_saveAccess(p) { return timedApi_("saveAccess", p); }
function api_saveAdmins(p) { return timedApi_("saveAdmins", p); }
function api_saveAccessMode(p) { return timedApi_("saveAccessMode", p); }
function api_getSettings(p) { return timedApi_("getSettings", p); }
function api_saveSettings(p) { return timedApi_("saveSettings", p); }
function api_reloadData(p) { return timedApi_("reloadData", p); }
function api_saveSharedView(p) { return timedApi_("saveSharedView", p); }
function api_deleteSharedView(p) { return timedApi_("deleteSharedView", p); }
function api_getDiagnostics(p) { return timedApi_("getDiagnostics", p); }
function api_exportToSheet(p) { return timedApi_("exportToSheet", p); }

/* ------------------------------------------------------- editor-run, not RPC */
/* Gated: these run as whoever opened the editor, which is not necessarily the owner. */

/** One-time owner setup. Seeds the owner and defaults; optionally binds the register Sheet. */
function setup(sheetUrl) {
  Server.access.assertOwner("setup");
  return Server.setup(sheetUrl);
}

/** Prints the diagnostics report (owner only). Run it from the editor after each deploy. */
function deploymentDiagnostic() {
  Server.access.assertOwner("deploymentDiagnostic");
  var text = Server.diagnosticsText();
  console.log(text);
  return text;
}
