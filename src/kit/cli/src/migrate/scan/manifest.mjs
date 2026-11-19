// Findings from a source app's appsscript.json (time zone, scopes, the webapp block, advanced
// services) and its .clasp.json (rootDir and whether a script id is set). The script id itself is
// never returned. Both are total: a bad file yields nulls and a problem line, never an exception.

/**
 * @typedef {object} ManifestFindings
 * @property {string | null} timeZone
 * @property {string[]} scopes
 * @property {{ access: string | null, executeAs: string | null } | null} webapp
 * @property {string[]} advancedServices serviceId of each enabled advanced service
 * @property {string[]} libraries userSymbol of each library dependency
 * @property {string | null} runtimeVersion
 * @property {string[]} problems
 */

/**
 * @typedef {object} ClaspFindings
 * @property {string | null} rootDir a safe relative posix path ("" for the project root), null when absent or unsafe
 * @property {boolean} hasScriptId
 * @property {string[]} problems
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @param {unknown} v */
function str(v) {
  return typeof v === "string" ? v : null;
}

/** @param {string} text @returns {{ ok: true, value: unknown } | { ok: false }} */
function parse(text) {
  try {
    return { ok: true, value: JSON.parse(String(text ?? "").replace(/^﻿/, "")) };
  } catch {
    return { ok: false };
  }
}

/**
 * @param {string} jsonText
 * @returns {ManifestFindings}
 */
export function scanManifest(jsonText) {
  /** @type {ManifestFindings} */
  const f = { timeZone: null, scopes: [], webapp: null, advancedServices: [], libraries: [], runtimeVersion: null, problems: [] };
  const p = parse(jsonText);
  if (!p.ok) {
    f.problems.push("appsscript.json is not valid JSON");
    return f;
  }
  const m = p.value;
  if (!isObj(m)) {
    f.problems.push("appsscript.json is not a JSON object");
    return f;
  }
  f.timeZone = str(m["timeZone"]);
  if (m["timeZone"] !== undefined && f.timeZone === null) f.problems.push("timeZone is not a string");
  if (f.timeZone === null) f.problems.push("no timeZone: the kit app needs one (it formats every date in it)");
  f.runtimeVersion = str(m["runtimeVersion"]);
  if (f.runtimeVersion !== "V8") f.problems.push("runtimeVersion is " + (f.runtimeVersion === null ? "not set" : JSON.stringify(f.runtimeVersion)) + "; the kit needs V8");
  const scopes = m["oauthScopes"];
  if (Array.isArray(scopes)) {
    for (const s of scopes) {
      if (typeof s === "string") f.scopes.push(s);
      else f.problems.push("oauthScopes holds a value that is not a string");
    }
  } else if (scopes !== undefined) f.problems.push("oauthScopes is not an array");
  else f.problems.push("no oauthScopes: Apps Script infers them from the code; the kit lists them explicitly");
  const w = m["webapp"];
  if (isObj(w)) {
    f.webapp = { access: str(w["access"]), executeAs: str(w["executeAs"]) };
    if (f.webapp.access === "ANYONE" || f.webapp.access === "ANYONE_ANONYMOUS") f.problems.push("webapp.access is " + f.webapp.access + ": anyone can reach every public global; the kit template deploys with DOMAIN, and the manifestWebapp contract pins the value");
    if (f.webapp.executeAs !== null && f.webapp.executeAs !== "USER_DEPLOYING") f.problems.push("webapp.executeAs is " + f.webapp.executeAs + "; kit apps run as USER_DEPLOYING");
  } else if (w !== undefined) f.problems.push("webapp is not an object");
  else f.problems.push("no webapp block: the source is not deployed as a web app");
  const deps = m["dependencies"];
  if (isObj(deps)) {
    const adv = deps["enabledAdvancedServices"];
    if (Array.isArray(adv)) for (const s of adv) if (isObj(s) && typeof s["serviceId"] === "string") f.advancedServices.push(s["serviceId"]);
    const libs = deps["libraries"];
    if (Array.isArray(libs)) for (const l of libs) if (isObj(l) && typeof l["userSymbol"] === "string") f.libraries.push(l["userSymbol"]);
    if (f.libraries.length) f.problems.push("library dependencies (" + f.libraries.join(", ") + ") are not carried; their code must be vendored or replaced");
  }
  return f;
}

/**
 * @param {string} jsonText
 * @returns {ClaspFindings}
 */
export function scanClasp(jsonText) {
  /** @type {ClaspFindings} */
  const f = { rootDir: null, hasScriptId: false, problems: [] };
  const p = parse(jsonText);
  if (!p.ok) {
    f.problems.push(".clasp.json is not valid JSON");
    return f;
  }
  const c = p.value;
  if (!isObj(c)) {
    f.problems.push(".clasp.json is not a JSON object");
    return f;
  }
  f.hasScriptId = typeof c["scriptId"] === "string" && c["scriptId"].trim() !== "";
  const r = c["rootDir"];
  if (r === undefined) return f;
  if (typeof r !== "string") {
    f.problems.push("rootDir is not a string");
    return f;
  }
  // rootDir comes from an untrusted repo: only a plain relative path below the project is kept.
  const norm = r.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (r.includes("\\") || r.startsWith("/") || /^[A-Za-z]:/.test(r) || /[\u0000-\u001f]/.test(r) || norm.split("/").some((s) => s === ".." || (s === "" && norm !== ""))) {
    f.problems.push("rootDir " + JSON.stringify(r) + " points outside the project or is not a plain relative path; it is ignored");
    return f;
  }
  f.rootDir = norm === "." ? "" : norm;
  return f;
}
