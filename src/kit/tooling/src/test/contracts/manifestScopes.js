// Extracted from the author's production Apps Script apps; adapted.
// appsscript.json oauthScopes are exactly the scopes implied by the services the server source
// uses: none missing, none extra, and only the readonly spreadsheet scope while nothing writes.
// A service may accept several scopes (any one satisfies it), so a narrower grant such as the
// per-file Drive scope is accepted rather than pushing an app towards over-privilege. A read need
// is also met by a broader scope that something else in the app needs (spreadsheets covers a
// Sheets read), but a broader scope declared with no such need is still reported as extra.
//
// Scan scope: the app's own server source plus the vendored kit's server package (kit/server),
// because the kit's server code is bundled into the deployed server and is what calls Session,
// ScriptApp and SpreadsheetApp. The kit's tooling, cli, client and ui packages are never scanned:
// they hold the contracts' own patterns and never run on Apps Script. The scan is not
// tree-shaken: an app that does not use a kit module (an app scaffolded with --source none still
// sees kit/server/src/sheetSource.ts, and triggers.ts always implies script.scriptapp) would be
// forced to declare that module's scope. List the unused module in allow (a relative path or file
// name, for example allow: ["sheetSource.ts", "triggers.ts"]) to leave it out of the scan. To scan something else
// (for example the built server bundle), pass its directory as srcDir with kitServer: false.
//
// Broad scopes are refused unless named in allowBroad: full Drive, drive.readonly, full
// Spreadsheets, Gmail, cloud-platform, script.projects and any admin.directory scope. Under
// USER_DEPLOYING each one hands every server bug the deploying account's whole reach. A declared
// scope is also reported when a narrower alternative the code accepts is enough (spreadsheets
// where spreadsheets.readonly or drive.file would do, drive where drive.file would do), unless
// allowBroad names it. UrlFetchApp needs script.external_request and a non-empty
// urlFetchWhitelist of https prefixes without wildcard hosts, userinfo or an empty host; neither
// may be declared without it. The vendored kit is kit/ right under srcDir, browser code client/
// right under it (a folder of either name deeper in the tree is scanned as app code).
import { isKitPath, read, scannedEnough, sourceFiles, stripComments, wire } from "./_util.js";
import { ADVANCED_WRITE_RE, ADVANCED_WRITE_VERBS, DOT, DRIVE_MUTATORS, SHEET_CLEAR_RE, SHEET_MUTATORS } from "./noMutators.js";

const A = "https://www.googleapis.com/auth/";
export const SHEETS_RO = A + "spreadsheets.readonly";
export const SHEETS_RW = A + "spreadsheets";
// drive.file is accepted for DriveApp: it covers the files the app created or opened (through a
// picker or by id), which is all a narrowly written app needs. Google's DriveApp page lists only
// drive and drive.readonly, so an app that reaches arbitrary files still needs drive.
export const DRIVE_FILE = A + "drive.file";
export const DRIVE_FULL = A + "drive";
export const DRIVE_RO = A + "drive.readonly";

/** Scopes refused unless listed in allowBroad. A trailing dot matches a family by prefix. */
export const BROAD_SCOPES = [DRIVE_FULL, DRIVE_RO, SHEETS_RW, "https://mail.google.com/", A + "cloud-platform", A + "script.projects", A + "admin.directory."];
const EXTERNAL = A + "script.external_request";

/** Narrower alternatives of a scope, in the order they are suggested. */
const NARROWER = { [DRIVE_FULL]: [DRIVE_FILE, DRIVE_RO], [DRIVE_RO]: [DRIVE_FILE], [SHEETS_RW]: [SHEETS_RO, DRIVE_FILE] };

/** @param {string} s */
export const isBroad = (s) => BROAD_SCOPES.some((b) => (b.endsWith(".") ? s.startsWith(b) : s === b));

/**
 * Service detectors: pattern found in code (comments stripped) -> the scopes that satisfy it
 * (any one of them is enough). The spreadsheet services are handled apart because the scope
 * depends on reads versus writes.
 * @typedef {{ service: string, re: RegExp, scopes: string[] }} ServiceScope
 * @type {ServiceScope[]}
 */
export const DEFAULT_SERVICE_SCOPES = [
  { service: "DriveApp", re: /\bDriveApp\b/, scopes: [DRIVE_FULL, DRIVE_FILE, DRIVE_RO] },
  { service: "Drive advanced service", re: /(?<![\w$.])Drive\s*[!?]*\s*\.\s*[A-Z]\w*/, scopes: [DRIVE_FULL, DRIVE_FILE, DRIVE_RO] },
  // A call of the kit's createFetch counts as UrlFetchApp: the app never names the service itself.
  { service: "UrlFetchApp", re: /\bUrlFetchApp\b|\bcreateFetch\s*\(/, scopes: [A + "script.external_request"] },
  { service: "Session user email", re: /\bSession\s*\.\s*get(?:Active|Effective)User\b/, scopes: [A + "userinfo.email"] },
  { service: "MailApp", re: /\bMailApp\b/, scopes: [A + "script.send_mail"] },
  { service: "GmailApp", re: /\bGmailApp\b/, scopes: ["https://mail.google.com/"] },
  { service: "CalendarApp", re: /\bCalendarApp\b/, scopes: [A + "calendar"] },
  { service: "DocumentApp", re: /\bDocumentApp\b/, scopes: [A + "documents"] },
  { service: "SlidesApp", re: /\bSlidesApp\b/, scopes: [A + "presentations"] },
  { service: "ScriptApp service or triggers", re: /\bScriptApp\s*\.\s*(?:newTrigger|getProjectTriggers|deleteTrigger|getService)\b/, scopes: [A + "script.scriptapp"] },
];

// A sheet writer by method name. The bare clear() is counted only on a receiver that looks like a
// sheet or range (SHEET_CLEAR_RE), because Map and Set have a clear() too.
const SHEET_WRITE_NAMES = SHEET_MUTATORS.filter((n) => n !== "clear");
const SHEET_WRITE_RE = new RegExp("\\.\\s*(?:" + SHEET_WRITE_NAMES.join("|") + ")\\s*\\(");
const SHEETS_ADV_WRITE_RE = new RegExp("(?<![\\w$.])Sheets(?:" + DOT + "[A-Za-z_]\\w*)*?" + DOT + "(?:" + ADVANCED_WRITE_VERBS.join("|") + ")\\s*\\(");
const DRIVE_WRITE_RE = new RegExp("\\.\\s*(?:" + DRIVE_MUTATORS.join("|") + ")\\s*\\(");

/**
 * The requirements a body of source text puts on the manifest.
 * @param {string} code comment-stripped source of every scanned file
 * @param {ServiceScope[]} map
 * @returns {{ why: string, anyOf: string[], covers: string[] }[]} one per distinct set of
 *   acceptable scopes. anyOf are the scopes that are exactly this need; covers are broader scopes
 *   that also satisfy it, accepted only because something else needs them (never reported as
 *   missing, and not by themselves a reason to keep a scope).
 */
export function requirements(code, map) {
  /** @type {Map<string, { why: string, anyOf: string[], covers: string[] }>} */ const out = new Map();
  /** @param {string} why @param {string[]} anyOf @param {string[]} [covers] */
  const need = (why, anyOf, covers = []) => {
    const key = anyOf.join("|");
    if (anyOf.length && !out.has(key)) out.set(key, { why, anyOf, covers });
  };
  const driveWrites = (DRIVE_WRITE_RE.test(code) && /\bDriveApp\b/.test(code)) || [...code.matchAll(ADVANCED_WRITE_RE)].some((m) => m[1].startsWith("Drive"));
  // a drive.readonly grant satisfies a Drive read but never a write
  for (const { service, re, scopes } of map) if (re.test(code)) need(service, driveWrites ? scopes.filter((x) => x !== DRIVE_RO) : scopes);
  const sheetsAdvanced = /(?<![\w$.])Sheets\s*[!?]*\s*\.\s*[A-Z]\w*/.test(code);
  const spreadsheetApp = /\bSpreadsheetApp\b/.test(code);
  const appWrites = spreadsheetApp && (SHEET_WRITE_RE.test(code) || SHEET_CLEAR_RE.test(code) || /\bSpreadsheetApp\s*\.\s*create\b/.test(code));
  const advWrites = sheetsAdvanced && SHEETS_ADV_WRITE_RE.test(code);
  // The built-in SpreadsheetApp checks its own scope family: a drive scope does not let it open a
  // spreadsheet, so only the read-write spreadsheets scope covers a SpreadsheetApp read. The Sheets
  // REST API behind the advanced service also accepts the drive scopes.
  if (appWrites) need("SpreadsheetApp writes", [SHEETS_RW]);
  else if (spreadsheetApp) need("SpreadsheetApp", [SHEETS_RO], [SHEETS_RW]);
  if (advWrites) need("Sheets advanced service writes", [SHEETS_RW, DRIVE_FILE]);
  else if (sheetsAdvanced) need("Sheets advanced service", [SHEETS_RO], [SHEETS_RW, DRIVE_FULL, DRIVE_RO]);
  if (driveWrites) need("Drive writes", [DRIVE_FULL, DRIVE_FILE]);
  return [...out.values()];
}

// Anchored to the first path segment under the scanned dir, as sourceFiles is: src/kit/server is
// the vendored kit; a folder named kit deeper in the tree is app code.
const KIT_SERVER_RE = /^kit\/server\//;
const FETCH_MODULE_RE = /\bexport\s+function\s+createFetch\b/;
const FETCH_USE_RE = /\bUrlFetchApp\b|\bcreateFetch\s*\(/g;

/**
 * @param {{ manifest: string | { oauthScopes?: string[], urlFetchWhitelist?: unknown }, srcDir: string | string[],
 *   map?: ServiceScope[], allow?: string[], includeClient?: boolean, includeKit?: boolean,
 *   kitServer?: boolean, minFiles?: number, allowBroad?: string[] }} opts
 *   srcDir: the app source, one directory or several. map replaces the default service table;
 *   each entry's scopes are alternatives (any one satisfies it), and a service that needs no
 *   scope (CacheService, LockService, PropertiesService, HtmlService) is not in it. The
 *   spreadsheet read versus write logic is fixed (it is not part of map). allow: files left out
 *   of the scan. Browser code (client/) is not scanned unless includeClient. The vendored kit:
 *   only kit/server is scanned by default (kitServer, true), since it is bundled into the server;
 *   includeKit scans every kit package, kit/tooling's own patterns included, which is rarely
 *   wanted. minFiles: fewest files the scan must see (default 1). allowBroad: broad scopes the app
 *   keeps on purpose (each one is a reviewed decision; see BROAD_SCOPES).
 * @returns {string[]} violations
 */
export function check({ manifest, srcDir, map = DEFAULT_SERVICE_SCOPES, allow = [], includeClient = false, includeKit = false, kitServer = true, minFiles = 1, allowBroad = [] }) {
  const m = typeof manifest === "string" ? JSON.parse(manifest) : manifest;
  const declared = new Set(Array.isArray(m && m.oauthScopes) ? m.oauthScopes : []);
  const inScope = (/** @type {{ rel: string }} */ f) => includeKit || !isKitPath(f.rel) || KIT_SERVER_RE.test(f.rel);
  const files = sourceFiles(srcDir, { allow, includeClient, includeKit: includeKit || kitServer }).filter(inScope);
  /** @type {string[]} */ const bad = scannedEnough(sourceFiles(srcDir, { includeClient, includeKit: includeKit || kitServer }).filter(inScope), minFiles, srcDir);
  // The module that defines createFetch (the kit's fetch.ts) is bundled only when an app imports
  // it, so its own mention of the service does not count; a call of createFetch anywhere else does.
  const code = files.map((f) => stripComments(read(f.file))).map((c) => (FETCH_MODULE_RE.test(c) ? c.replace(FETCH_USE_RE, "") : c)).join("\n");
  const reqs = requirements(code, map);
  const accepted = new Set(reqs.flatMap((r) => r.anyOf));
  for (const r of reqs) if (![...r.anyOf, ...r.covers].some((s) => declared.has(s))) bad.push("manifest is missing " + r.anyOf.join(" or ") + " (needed by " + r.why + ")");
  for (const s of declared) if (!accepted.has(s)) bad.push("manifest declares " + s + " but no source uses a service that needs it");
  for (const s of declared) {
    if (allowBroad.includes(s) || !accepted.has(s)) continue;
    // Narrower alternatives that satisfy every requirement this scope is declared for.
    const needs = reqs.filter((r) => r.anyOf.includes(s));
    const narrower = (/** @type {Record<string, string[]>} */ (NARROWER)[s] || []).filter((n) => needs.every((r) => r.anyOf.includes(n)));
    const hint = narrower.length ? "; the narrower " + narrower.join(" or ") + " is enough for " + needs.map((r) => r.why).join(", ") : "";
    if (isBroad(s)) bad.push("manifest declares the broad scope " + s + hint + "; narrow it, or list it in allowBroad as a reviewed decision");
    else if (narrower.length) bad.push("manifest declares " + s + hint);
  }
  const usesFetch = reqs.some((r) => r.anyOf.includes(EXTERNAL));
  const list = m && m.urlFetchWhitelist;
  if (usesFetch) {
    if (!Array.isArray(list) || !list.length) bad.push("UrlFetchApp is used but the manifest has no urlFetchWhitelist; list the exact https prefixes the app calls");
    else {
      for (const u of list) {
        const host = typeof u === "string" ? /^https:[/][/]([^/]*)[/]/.exec(u) : null;
        if (!host) bad.push("urlFetchWhitelist entry " + JSON.stringify(u) + " is not an https prefix ending in a slash after the host");
        else if (!host[1]) bad.push("urlFetchWhitelist entry " + JSON.stringify(u) + " has an empty host; name the host");
        else if (host[1].includes("@")) bad.push("urlFetchWhitelist entry " + JSON.stringify(u) + " carries userinfo (a name before @), so the host it names is not the one it appears to; write the host alone");
        else if (host[1].includes("*")) bad.push("urlFetchWhitelist entry " + JSON.stringify(u) + " has a wildcard host; name each host");
      }
    }
  } else if (list !== undefined) bad.push("the manifest has a urlFetchWhitelist but no source uses UrlFetchApp; remove it");
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "manifest scopes", () => check(opts));
}
