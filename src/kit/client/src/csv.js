// Extracted from the author's production Apps Script apps; adapted.
// Rows to CSV text. Every cell goes through csvCell, which quotes as RFC 4180 says and prefixes
// a string that starts with = + - @ tab or CR with an apostrophe, so a spreadsheet reads it as
// text, not as a formula (CSV injection, CWE-1236). The lead is also found behind leading
// blanks (space, no-break space, zero-width space, ideographic space, byte-order mark), which a
// spreadsheet may trim, and in its full-width form (U+FF1D, U+FF0B, U+FF0D, U+FF20), which one
// may fold. A number is never prefixed: the test is on
// the JS type, so -5 stays a number and "-5" from a text field is guarded. The same lead after
// an embedded semicolon, tab, CR or LF (optionally followed by blanks) is prefixed too: Excel in
// a locale whose list separator is ";" splits a line there, quotes or not, so "Acme;=1+1"
// would start a new cell with a formula. No "sep=" line is written: it breaks Excel's BOM
// handling. Lines end in CRLF and the file starts with a UTF-8 byte-order mark so Excel reads
// accented text correctly.

/** The UTF-8 byte-order mark toCsv puts at the start of the text. */
export const BOM = "﻿";

const FORMULA_LEAD = /^[ \u00a0\u200b\u3000\ufeff]*[=+\-@\uff1d\uff0b\uff0d\uff20\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;
const EMBEDDED_LEAD = /([;\t\r\n][ \u00a0\u200b\u3000\ufeff]*)([=+\-@\uff1d\uff0b\uff0d\uff20])/g;

/**
 * One CSV cell. null and undefined are an empty cell.
 * @param {unknown} v
 * @returns {string}
 */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v !== "number") {
    if (FORMULA_LEAD.test(s)) s = "'" + s;
    s = s.replace(EMBEDDED_LEAD, "$1'$2");
  }
  return NEEDS_QUOTES.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * One line, with no terminator.
 * @param {ReadonlyArray<unknown>} cells
 * @returns {string}
 */
export function csvLine(cells) {
  return cells.map(csvCell).join(",");
}

/**
 * The whole file: the BOM, then each row ended by CRLF. Hand it to downloadText without its
 * `bom` option, so the mark appears once.
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} matrix
 * @returns {string}
 */
export function toCsv(matrix) {
  return BOM + matrix.map((r) => csvLine(r) + "\r\n").join("");
}

/**
 * A file name from parts: each part lower-cased with everything outside [a-z0-9-] removed,
 * empty parts dropped, joined with "-", then "." and the extension. No usable part gives
 * "export". exportFileName(["Acme", "List", "2026-01-31"], "csv") is "acme-list-2026-01-31.csv".
 * @param {ReadonlyArray<unknown>} parts
 * @param {string} ext
 * @returns {string}
 */
export function exportFileName(parts, ext) {
  const clean = (Array.isArray(parts) ? parts : [])
    .map((p) => String(p == null ? "" : p).toLowerCase().replace(/[^a-z0-9-]+/g, ""))
    .filter(Boolean);
  return (clean.length ? clean.join("-") : "export") + "." + ext;
}
