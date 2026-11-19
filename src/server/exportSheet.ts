// "New Google Sheet": the rows the person sees, as a new spreadsheet shared with them.
//
// The client sends row ids and column keys, never values. The rows are rebuilt here from the
// cached register with the same shared domain code the browser uses, so a caller cannot make
// the app write text of their choosing into a file shared under the deployer's name. Order of
// work: validate (the kit's cleanIds and cleanTitle), throttle (the kit's throttleExports),
// rebuild, then the kit's createSheetExport: CREATE the new spreadsheet, refuse if its id is the
// source id, set the file so its writers cannot re-share it, write the values RAW (a leading '='
// stays text), bold the header, share the file with the viewer as writer without a notification.
// Any failure after the create trashes the new file and answers one fixed sentence.
//
// This module calls neither the Sheets nor the Drive service: only the kit's sheetExport does.
// The source Sheet is never touched: nothing here opens it, and the new file has a new id.

import { COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS, isColumnKey, type Column } from "../domain/columns";
import { exportRows } from "../domain/exportRows";
import { makeRow, type Row } from "../domain/facets";
import { decodeRegister } from "../domain/payload";
import { completeness } from "../domain/quality";
import { evaluateAll } from "../domain/rules";
import { access } from "./access";
import { todayIn } from "./bootstrap";
import {
  ApiError, cleanIds, cleanTitle, createSheetExport, EXPORT_LIMIT, EXPORT_MAX_ROWS, EXPORT_WINDOW_SEC, throttleExports,
} from "@gas-kit/server";
import { registerEntry } from "./registerStore";
import { loadSettings } from "./settingsStore";

export { EXPORT_LIMIT, EXPORT_MAX_ROWS, EXPORT_WINDOW_SEC };
export const SHEET_TAB = "Applications";

export interface ExportParams { ids?: unknown; columns?: unknown; title?: unknown }
export interface ExportResult { id: string; url: string; rows: number; shared: boolean }

/** Known column keys in the order given; none known means the default columns. */
function cleanColumns(raw: unknown): Column[] {
  const keys = Array.isArray(raw) ? raw.filter(isColumnKey) : [];
  const uniq = keys.filter((k, i) => keys.indexOf(k) === i);
  return (uniq.length ? uniq : DEFAULT_COLUMN_KEYS.slice()).map((k) => COLUMN_BY_KEY[k]!);
}

/** The rows for these ids, rebuilt from the register with the live rules and today. */
function rowsFor(ids: readonly string[]): Row[] {
  const entry = registerEntry();
  const settings = loadSettings();
  const apps = decodeRegister(entry.register);
  const today = todayIn(entry.meta.tz);
  const status = evaluateAll(apps, settings.rules, today);
  const byId = new Map<string, Row>();
  apps.forEach((a, i) => byId.set(a.id, makeRow(a, status[i]!, completeness(a).pct)));
  const out: Row[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r) out.push(r);
  }
  return out;
}

export function exportToSheet(p?: ExportParams): ExportResult {
  const ids = cleanIds(p?.ids, EXPORT_MAX_ROWS);
  const columns = cleanColumns(p?.columns);
  const title = cleanTitle(p?.title, "Applications");
  const email = access.decide().email;
  // Five per ten minutes per viewer. It takes the script lock itself, so it is called outside any lock.
  throttleExports(email, { limit: EXPORT_LIMIT, windowSec: EXPORT_WINDOW_SEC });

  const rows = rowsFor(ids);
  if (rows.length === 0) throw new ApiError("error", "None of those applications are in the register any more.");
  const matrix = exportRows(rows, columns);

  const entry = registerEntry();
  const source = loadSettings().source.sheetId;
  return createSheetExport({
    title,
    tab: SHEET_TAB,
    prefix: "CCCP export",
    matrix,
    viewerEmail: email,
    ownerEmail: access.ownerEmail(),
    forbidIds: source ? [source] : [],
    tz: entry.meta.tz || "Etc/GMT",
  });
}
