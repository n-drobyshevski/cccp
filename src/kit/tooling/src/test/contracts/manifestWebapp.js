// appsscript.json runs the web app the one safe way: as the deploying account (under
// USER_ACCESSING every caller would be the owner the access check compares against), open to
// exactly the audience the app declares (default DOMAIN, so widening it to ANYONE or
// ANYONE_ANONYMOUS takes a second, reviewable edit where the contract is registered), with no
// Apps Script API executable surface, no library pinned to its development head, the V8 runtime
// and exception logging on.
import { readFileSync } from "node:fs";
import { wire } from "./_util.js";

export const ACCESS_VALUES = ["MYSELF", "DOMAIN", "ANYONE", "ANYONE_ANONYMOUS"];

/**
 * @param {{ manifestPath?: string, manifest?: string | Record<string, any>, access?: string }} opts
 *   manifestPath: the appsscript.json file (or manifest, its text or parsed object). access: the
 *   webapp.access value the app declares (default DOMAIN); the manifest must equal it exactly.
 * @returns {string[]} violations
 */
export function check({ manifestPath, manifest, access = "DOMAIN" }) {
  /** @type {any} */ let m = manifest;
  try {
    if (m === undefined) m = manifestPath ? readFileSync(manifestPath, "utf8") : undefined;
    if (typeof m === "string") m = JSON.parse(m);
  } catch (e) {
    return ["the manifest cannot be read: " + /** @type {Error} */ (e).message];
  }
  if (!m || typeof m !== "object") return ["manifestWebapp needs manifestPath or manifest"];
  /** @type {string[]} */ const bad = [];
  if (!ACCESS_VALUES.includes(access)) bad.push("the declared access " + JSON.stringify(access) + " is not one of " + ACCESS_VALUES.join(", "));
  const w = m.webapp;
  if (!w || typeof w !== "object") bad.push("the manifest has no webapp section");
  else {
    if (w.executeAs !== "USER_DEPLOYING") bad.push("webapp.executeAs is " + JSON.stringify(w.executeAs) + "; it must be USER_DEPLOYING (as the visitor, every caller would be the owner)");
    if (w.access !== access) bad.push("webapp.access is " + JSON.stringify(w.access) + " but the app declares " + JSON.stringify(access) + "; change both together, on purpose");
  }
  if ("executionApi" in m) bad.push("the manifest has an executionApi section: the Apps Script API could then run any top-level function; remove it");
  const libs = m.dependencies && Array.isArray(m.dependencies.libraries) ? m.dependencies.libraries : [];
  for (const l of libs) {
    if (l && l.developmentMode) bad.push("library " + JSON.stringify(l.userSymbol || l.libraryId) + " is in development mode, so it runs its owner's latest code; pin a version");
  }
  if (m.runtimeVersion !== "V8") bad.push("runtimeVersion is " + JSON.stringify(m.runtimeVersion) + "; it must be V8");
  if (m.exceptionLogging !== "STACKDRIVER") bad.push("exceptionLogging is " + JSON.stringify(m.exceptionLogging) + "; set it to STACKDRIVER so failures reach the execution log");
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "manifest web app settings", () => check(opts));
}
