// Rows to CSV text. Every cell goes through the vendored csvCell, which prefixes a string that
// starts with = + - @ tab or CR with an apostrophe (CSV injection) and quotes as RFC 4180
// says. Lines end in CRLF and the text starts with a UTF-8 byte-order mark so Excel reads
// accented names correctly. A number is never prefixed.
import { csvCell } from "../../vendor/gas_shared/domain/csv";

export const BOM = "﻿";

/** One line, no terminator. */
export function csvLine(cells) {
  return cells.map(csvCell).join(",");
}

/** The whole file: BOM, then each row ended by CRLF. `matrix` is an array of cell arrays. */
export function toCsv(matrix) {
  return BOM + matrix.map((r) => csvLine(r) + "\r\n").join("");
}

/** 'cccp-list-2026-11-11.csv'. A missing date is left out. */
export function exportName(route, today, ext) {
  const safe = (v) => String(v == null ? "" : v).replace(/[^a-z0-9-]+/gi, "").toLowerCase();
  return ["cccp", safe(route) || "export", safe(today)].filter(Boolean).join("-") + "." + ext;
}
