// Extracted from the author's production Apps Script apps; adapted.
// No Sheets or Drive writer appears in server source outside an allow list of files: neither a
// SpreadsheetApp / DriveApp mutator method name nor a write through the Sheets or Drive advanced
// services (Sheets.Spreadsheets.Values.update, Drive.Files.create, ...). A read-only app keeps
// its promise by never naming a writer; the scan is by name on purpose. Browser code (client/)
// and the vendored kit (kit/), each right under srcDir, are not scanned unless asked; a folder of
// either name deeper in the tree is server code and is scanned, as is every script extension.
import { lineOf, read, scannedEnough, sourceFiles, stripComments, wire } from "./_util.js";

/** Mutator method names of the Spreadsheet service. */
export const SHEET_MUTATORS = [
  "setValue", "setValues", "setFormula", "setFormulas", "setFormulaR1C1", "setFormulasR1C1", "appendRow",
  "insertSheet", "deleteSheet", "duplicateSheet", "copyTo", "moveTo", "moveRows", "moveColumns",
  "insertRows", "insertRowsAfter", "insertRowsBefore", "insertRowBefore", "insertRowAfter",
  "insertColumns", "insertColumnsAfter", "insertColumnsBefore", "insertColumnBefore", "insertColumnAfter",
  "deleteRow", "deleteRows", "deleteColumn", "deleteColumns",
  "clear", "clearContent", "clearContents", "clearFormat", "clearFormats", "clearNotes",
  "setNote", "setNotes", "setBackground", "setBackgrounds", "setFontColor", "setFontWeight",
  "setFrozenRows", "setFrozenColumns", "setNumberFormat", "setNumberFormats",
  "setSpreadsheetTimeZone", "setSpreadsheetLocale", "setDataValidation", "insertCheckboxes",
  "setConditionalFormatRules", "protect", "setActiveSheet",
];

/** Mutator method names of the Drive service. */
export const DRIVE_MUTATORS = [
  "createFile", "createFolder", "setContent", "setSharing", "setTrashed", "makeCopy",
  "addEditor", "addEditors", "addViewer", "addViewers", "removeEditor", "removeEditors", "removeViewer", "removeViewers",
];

export const MUTATORS = [...SHEET_MUTATORS, ...DRIVE_MUTATORS];

/** Verbs that write when they end a Sheets.* or Drive.* advanced-service call chain. */
export const ADVANCED_WRITE_VERBS = [
  "create", "update", "append", "batchUpdate", "batchClear", "clear", "copy", "remove", "insert", "patch",
  "trash", "emptyTrash", "batchUpdateByDataFilter", "clearByDataFilter", "updateByDataFilter", "appendByDataFilter",
];

// A member access, tolerating the TypeScript non-null and optional-chain marks: Sheets!.Spreadsheets!.create.
export const DOT = "\\s*[!?]*\\s*\\.\\s*";

/**
 * Pattern for a write through the Sheets or Drive advanced service: Sheets.Spreadsheets.create,
 * Sheets.Spreadsheets.Values.update / append / batchUpdate / clear, Sheets.Spreadsheets.batchUpdate,
 * Drive.Files.create / update / copy, Drive.Permissions.create, and so on. Read verbs (get, list,
 * export) do not match.
 */
export const ADVANCED_WRITE_RE = new RegExp(
  "(?<![\\w$.])((?:Sheets|Drive)(?:" + DOT + "[A-Za-z_]\\w*)*?" + DOT + "(?:" + ADVANCED_WRITE_VERBS.join("|") + "))\\s*\\(",
  "g",
);

/** Any use of the Sheets or Drive advanced service: the capitalised member right after the name. */
export const ADVANCED_USE_RE = /(?<![\w$.])(?:Sheets|Drive)\s*[!?]*\s*\.\s*[A-Z]\w*/g;

// The bare clear() is a sheet or range writer only on a receiver that looks like one: Map, Set and
// cache objects have a clear() too.
export const SHEET_CLEAR_RE = /(?:[\w$]*(?:[Ss]heet|[Rr]ange|[Ss]preadsheet|[Cc]ell|[Rr]ng)[\w$]*|\b(?:ss|sh|rg))\s*(?:\([^()]*\))?\s*(?:\[[^\]]*\])?\s*\.\s*clear\s*\(/;

// setContent() is also a normal HtmlOutput / HtmlTemplate call. It counts as a Drive writer unless
// the statement it sits in mentions HtmlService or its receiver is named like an html object.
const HTML_RECEIVER_RE = /(?:[Hh]tml|[Oo]utput|[Tt]emplate)[\w$]*\s*(?:\([^()]*\))?\s*$/;

/**
 * @param {string} code @param {number} at offset of the "." before the method name
 */
function htmlSetContent(code, at) {
  const chunk = code.slice(Math.max(0, at - 160), at).split(/[;{}]/).pop() || "";
  return /\bHtmlService\b/.test(chunk) || HTML_RECEIVER_RE.test(chunk);
}

/**
 * @param {{ srcDir: string | string[], allow?: string[], names?: string[], includeClient?: boolean,
 *   includeKit?: boolean, confineAdvanced?: string[], minFiles?: number }} opts
 *   allow: files (relative path, file name or suffix) that may write, such as the one module that
 *   writes an export. names: the method names to ban (default MUTATORS). includeClient and
 *   includeKit scan browser code and the vendored kit too (both skipped by default).
 *   confineAdvanced: when given, any use of the Sheets or Drive advanced service outside these
 *   files is a violation, read or write. minFiles: fewest files the scan must see (default 1), so
 *   a wrong srcDir fails loudly. The bare clear() counts only on a sheet or range looking
 *   receiver, and setContent() not on an HtmlService result or an html, output or template
 *   variable.
 * @returns {string[]} violations
 */
export function check({ srcDir, allow = [], names = MUTATORS, includeClient = false, includeKit = false, confineAdvanced, minFiles = 1 }) {
  const plain = names.filter((n) => n !== "clear");
  const re = new RegExp("(?:\\.\\s*|\\[\\s*[\"'])(" + (plain.join("|") || "(?!)") + ")(?:[\"']\\s*\\])?\\s*\\(", "g");
  const files = sourceFiles(srcDir, { allow, includeClient, includeKit });
  /** @type {string[]} */ const bad = scannedEnough(sourceFiles(srcDir, { includeClient, includeKit }), minFiles, srcDir);
  for (const { file, rel } of files) {
    const code = stripComments(read(file));
    const adv = [...code.matchAll(ADVANCED_WRITE_RE)];
    // a verb that ends an advanced-service chain is reported once, as the chain
    const inChain = (/** @type {number} */ at) => adv.some((a) => at >= a.index && at < a.index + a[0].length);
    for (const m of code.matchAll(re)) {
      if (inChain(m.index) || (m[1] === "setContent" && htmlSetContent(code, m.index))) continue;
      bad.push(rel + ":" + lineOf(code, m.index) + " calls the mutator " + m[1] + "()");
    }
    if (names.includes("clear")) for (const m of code.matchAll(new RegExp(SHEET_CLEAR_RE.source, "g"))) if (!inChain(m.index)) bad.push(rel + ":" + lineOf(code, m.index) + " calls the mutator clear()");
    for (const m of adv) bad.push(rel + ":" + lineOf(code, m.index) + " writes through the advanced service " + m[1].replace(/\s+/g, "") + "()");
  }
  if (confineAdvanced) {
    for (const { file, rel } of sourceFiles(srcDir, { includeClient, includeKit })) {
      if (confineAdvanced.some((a) => rel === a || rel.endsWith("/" + a))) continue;
      const code = stripComments(read(file));
      for (const m of code.matchAll(ADVANCED_USE_RE)) bad.push(rel + ":" + lineOf(code, m.index) + " uses the advanced service " + m[0].replace(/\s+/g, "") + " outside " + confineAdvanced.join(", "));
    }
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no mutators", () => check(opts));
}
