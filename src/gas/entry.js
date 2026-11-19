/**
 * src/gas/entry.js: the GAS globals, hand-written and copied to dist/ by the build.
 *
 * esbuild bundles src/server into dist/server.js as an IIFE assigned to the global `Server`.
 * Apps Script can only call top-level functions, so every callable surface needs a thin
 * global here that delegates into that namespace. This file is not generated:
 * test/build/entryPoints.test.js and the build's drift guard hold it in step with
 * src/server/api.ts, because a missing delegator fails silently and only in production.
 *
 * Derived from sidekick gas_hub/dist/entry.js at commit 77bcf22 (see VENDOR.md), then moved onto
 * the kit's entry shape (gas-kit templates/register/src/gas/entry.js).
 *
 * Every entry point (doGet, timedApi_, setup, deploymentDiagnostic) calls Server.beginExecution()
 * before any check reads a property: the kit keeps one snapshot of the Script Properties and a
 * memory of cache reads per execution, and this marks where one starts.
 */

/** The web-app entry. Refuses before it draws. There is no welcome gate. */
function doGet(e) {
  Server.beginExecution();
  var denied = Server.access.deniedPage();
  if (denied) return denied;
  return Server.doGet(e);
}

/**
 * Used by the include scriptlets in index.html. Gated: as a top-level global it would otherwise
 * be an open file-read primitive for any caller of google.script.run. A fault in the check
 * answers an empty string and the text goes to console.error only (checkFault_).
 */
function include(filename) {
  try {
    if (Server.access.denyResult("include")) return "";
  } catch (e) {
    checkFault_("include", e);
    return "";
  }
  return Server.include(filename);
}

/** Log a fault in an entry check (the text to console.error only) and give the fixed envelope. */
function checkFault_(name, e) {
  try {
    console.error(JSON.stringify({ entry: "check-failed", api: name, error: String(e && e.message ? e.message : e).slice(0, 500) }));
  } catch (ignored) {
    // best-effort
  }
  return { ok: false, errorKind: "error", error: Server.UNEXPECTED_ERROR_MESSAGE };
}

/**
 * The one chokepoint every RPC passes through: check access, time the call, log the timing with
 * the caller's role (never the address: the audit trail names people, the timing line does not).
 * The {ok, data} envelope and the role check live in the server (api.ts and run), so the dev
 * server and the deployment agree. A fault in the checks never reaches the caller as the
 * service's text: the fixed sentence goes back and the text to console.error (checkFault_).
 */
function timedApi_(name, params) {
  var role;
  try {
    Server.beginExecution();
    var denied = Server.access.denyResult(name);
    if (denied) return denied;
    role = Server.access.role();
  } catch (e) {
    return checkFault_(name, e);
  }
  var t0 = Date.now();
  var res = Server.api[name](params || {});
  console.log(JSON.stringify({ api: name, ms: Date.now() - t0, role: role }));
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
function api_probeSource(p) { return timedApi_("probeSource", p); }
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
  Server.beginExecution();
  Server.access.assertOwner("setup");
  return Server.setup(sheetUrl);
}

/** Prints the diagnostics report (owner only). Run it from the editor after each deploy. */
function deploymentDiagnostic() {
  Server.beginExecution();
  Server.access.assertOwner("deploymentDiagnostic");
  var text = Server.diagnosticsText();
  console.log(text);
  return text;
}
