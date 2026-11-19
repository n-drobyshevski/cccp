// Server TypeScript and entry.js are outside the ESLint preset (it ignores .ts, and apps ignore
// src/gas), so the calls that turn one server bug into a breach are banned here:
//   frameAllowAll   XFrameOptionsMode.ALLOWALL: any site can frame the app (clickjacking)
//   oauthToken      ScriptApp.getOAuthToken(): the deployer's token, which any viewer would get
//   identityToken   ScriptApp.getIdentityToken()
//   eval            eval( and new Function( (or Function( called bare): code from data
//   contentService  ContentService: a raw text or JSON answer outside the access and envelope path
//   htmlAppend      HtmlOutput .append( or createHtmlOutput( with anything but one string literal,
//                   allowed by default only in the kit's page module (page.ts); the Sheets
//                   service's Values.append is not an HtmlOutput and is not counted
//   htmlSetContent  HtmlOutput .setContent( with anything but one string literal (allowed by
//                   default only in page.ts). DriveApp's File.setContent is a writer, so it is
//                   reported here too, besides noMutators
//   htmlFromFile    createHtmlOutputFromFile( or createTemplateFromFile( with anything but one
//                   string literal: a caller-chosen name serves any file of the project (allowed
//                   by default only in page.ts, whose include reads a name the template gives)
//   htmlTemplate    createTemplate( with any argument: a template built from text evaluates
//                   every scriptlet in it on the server, as the deploying account
//   session         Session.getEffectiveUser / getActiveUser (also through Session?. or
//                   Session!.): identity is read once per execution by the kit's identity module
//                   (not exported; access, setup and triggers import it), allowed by default only
//                   there and in the app's server/setup.ts
//   urlFetch        UrlFetchApp: allowed by default only in the kit's own fetch module (its path in
//                   the kit repository, packages/server/src/fetch.ts, or in an app,
//                   kit/server/src/fetch.ts), the one place that applies the host allow-list. An
//                   app file of any name, fetch.ts included, is reported unless the app lists it
//                   in allow with a reason
// Comments may name them; code may not. A string key such as XFrameOptionsMode["ALLOWALL"] counts.
//
// Scanned: every script extension (.ts, .mts, .cts, .tsx, .js, .mjs, .cjs, .jsx; declaration
// files excluded) outside client/ and kit/ right under srcDir. A folder named client or kit deeper
// in the tree is server code like any other.
import { SOURCE_EXTS, isDeclarationFile, lineOf, read, scannedEnough, sourceFiles, stripComments, wire } from "./_util.js";

/** @typedef {"frameAllowAll" | "oauthToken" | "identityToken" | "eval" | "contentService" | "htmlAppend" | "htmlSetContent" | "htmlFromFile" | "htmlTemplate" | "session" | "urlFetch"} RuleId */

// The rest of an argument list that is empty or exactly one single- or double-quoted string
// literal (used inside a negative lookahead: anything else is reported).
const LITERAL_ARG = "\\)|([\"'])[^\"'\\n]*\\1\\s*\\)";

/** @type {{ id: RuleId, re: RegExp, what: string }[]} */
export const RULES = [
  { id: "frameAllowAll", re: /\bALLOWALL\b/g, what: "XFrameOptionsMode.ALLOWALL lets any site frame the app" },
  { id: "oauthToken", re: /\bgetOAuthToken\b/g, what: "getOAuthToken hands out the deploying account's token" },
  { id: "identityToken", re: /\bgetIdentityToken\b/g, what: "getIdentityToken hands out an identity token" },
  { id: "eval", re: /(?<![\w$])eval\s*\(|\bnew\s+Function\s*\(|(?<![\w$.])Function\s*\(/g, what: "eval or new Function runs text as code" },
  { id: "contentService", re: /\bContentService\b/g, what: "ContentService answers outside the access check and the envelope" },
  { id: "htmlAppend", re: /(?<!\bValues\s*[!?]?\s*)\.\s*append\s*\(\s*(?!(["'])[^"'\n]*\1\s*\))|\bcreateHtmlOutput\s*\(\s*(?!\)|(["'])[^"'\n]*\2\s*\))/g, what: "HtmlOutput markup built from a non-literal value is an injection sink" },
  { id: "htmlSetContent", re: new RegExp("\\.\\s*setContent\\s*\\(\\s*(?!" + LITERAL_ARG + ")", "g"), what: "HtmlOutput.setContent with a non-literal value is an injection sink" },
  { id: "htmlFromFile", re: new RegExp("\\bcreate(?:HtmlOutput|Template)FromFile\\s*\\(\\s*(?!" + LITERAL_ARG + ")", "g"), what: "an HtmlService file named by a non-literal value serves whatever file the value names" },
  { id: "htmlTemplate", re: /\bcreateTemplate\s*\(/g, what: "createTemplate evaluates the scriptlets of its text on the server, as the deploying account" },
  { id: "session", re: /\bSession\s*[!?]*\s*\.\s*get(?:Effective|Active)User\b/g, what: "Session user identity is read outside the identity module" },
  { id: "urlFetch", re: /\bUrlFetchApp\b/g, what: "UrlFetchApp is called outside the fetch module" },
];

/** Files each rule allows by default (a relative path, a file name or a path suffix). */
export const DEFAULT_ALLOW = {
  htmlAppend: ["server/src/page.ts"],
  htmlSetContent: ["server/src/page.ts"],
  htmlFromFile: ["server/src/page.ts"],
  htmlTemplate: ["server/src/page.ts"],
  session: ["server/src/identity.ts", "server/setup.ts"],
  urlFetch: ["packages/server/src/fetch.ts", "kit/server/src/fetch.ts"],
};

/**
 * @param {{ srcDir: string | string[], allow?: Partial<Record<RuleId, string[]>>, skip?: string[], includeKit?: boolean, minFiles?: number }} opts
 *   srcDir: the app source; server code and entry.js are scanned (every script extension
 *   outside client/ right under srcDir; the vendored kit, kit/ right under srcDir, is skipped
 *   unless includeKit). allow: per rule id, files where it
 *   is allowed, added to DEFAULT_ALLOW. skip: files left out of the scan altogether (generated
 *   text, for example). minFiles: fewest files the scan must see (default 1).
 * @returns {string[]} violations
 */
export function check({ srcDir, allow = {}, skip = [], includeKit = false, minFiles = 1 }) {
  const files = sourceFiles(srcDir, { exts: SOURCE_EXTS, allow: skip, includeKit, includeClient: false }).filter((f) => !isDeclarationFile(f.rel));
  /** @type {string[]} */ const bad = scannedEnough(files, minFiles, srcDir);
  for (const { file, rel } of files) {
    const code = stripComments(read(file));
    for (const r of RULES) {
      const allowed = [...(/** @type {Record<string, string[]>} */ (DEFAULT_ALLOW)[r.id] || []), ...(allow[r.id] || [])];
      if (allowed.some((a) => rel === a || rel.endsWith("/" + a))) continue;
      for (const m of code.matchAll(r.re)) bad.push(rel + ":" + lineOf(code, /** @type {number} */ (m.index)) + " " + r.what + " (" + r.id + ")");
    }
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no dangerous server APIs", () => check(opts));
}
