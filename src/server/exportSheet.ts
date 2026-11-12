// "New Google Sheet": the ONLY module that calls the Sheets and Drive advanced services.
//
// The client sends row ids and column keys, never values. The rows are rebuilt here from the
// cached register with the same shared domain code the browser uses, so a caller cannot make
// the app write text of their choosing into a file shared under the deployer's name. Order of
// work: validate, throttle, rebuild, CREATE the new spreadsheet, refuse if its id is the
// source id, write the values RAW (a leading '=' stays text), bold the header, share the file
// with the viewer as writer without a notification, return the link.
//
// The source Sheet is never touched: nothing here opens it, and the new file has a new id.

import { COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS, isColumnKey, type Column } from "../domain/columns";
import { exportRows } from "../domain/exportRows";
import { makeRow, type Row } from "../domain/facets";
import { decodeRegister } from "../domain/payload";
import { completeness } from "../domain/quality";
import { evaluateAll } from "../domain/rules";
import { sha1Hex } from "../vendor/gas_shared/domain/sha1";
import * as access from "./access";
import { todayIn } from "./bootstrap";
import { ApiError } from "./errors";
import { withScriptLock } from "./locks";
import { registerEntry } from "./registerStore";
import { loadSettings } from "./settingsStore";

export const EXPORT_LIMIT = 5;
export const EXPORT_WINDOW_SEC = 600;
export const EXPORT_MAX_ROWS = 20_000;
export const SHEET_TAB = "Applications";
const TITLE_MAX = 80;

export interface ExportParams { ids?: unknown; columns?: unknown; title?: unknown }
export interface ExportResult { id: string; url: string; rows: number }

const clean = (v: unknown): string => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** Ids in the order given, as strings, without repeats. Anything else is refused. */
function cleanIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("Nothing to export.");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || v === "" || v.length > 200) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  if (out.length === 0) throw new Error("Nothing to export.");
  if (out.length > EXPORT_MAX_ROWS) throw new Error("Too many applications to export at once (the limit is " + EXPORT_MAX_ROWS + ").");
  return out;
}

/** Known column keys in the order given; none known means the default columns. */
function cleanColumns(raw: unknown): Column[] {
  const keys = Array.isArray(raw) ? raw.filter(isColumnKey) : [];
  const uniq = keys.filter((k, i) => keys.indexOf(k) === i);
  return (uniq.length ? uniq : DEFAULT_COLUMN_KEYS.slice()).map((k) => COLUMN_BY_KEY[k]!);
}

function throttleKey(email: string): string {
  return "cccp:export:" + sha1Hex(email.trim().toLowerCase());
}

/** Five exports per ten minutes per viewer, counted in the script cache under the script lock. */
function throttle(email: string): void {
  withScriptLock(() => {
    const cache = CacheService.getScriptCache();
    const key = throttleKey(email);
    const now = Date.now();
    let stamps: number[] = [];
    try {
      const parsed = JSON.parse(cache.get(key) || "[]");
      if (Array.isArray(parsed)) stamps = parsed.filter((t) => typeof t === "number" && now - t < EXPORT_WINDOW_SEC * 1000);
    } catch (_e) {
      stamps = [];
    }
    if (stamps.length >= EXPORT_LIMIT) {
      const wait = Math.max(1, Math.ceil((stamps[0]! + EXPORT_WINDOW_SEC * 1000 - now) / 60_000));
      throw new ApiError("busy", "You can create " + EXPORT_LIMIT + " Google Sheets every 10 minutes. Try again in about " + wait + (wait === 1 ? " minute." : " minutes."));
    }
    stamps.push(now);
    cache.put(key, JSON.stringify(stamps), EXPORT_WINDOW_SEC);
  });
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
  const ids = cleanIds(p?.ids);
  const columns = cleanColumns(p?.columns);
  const title = clean(p?.title).slice(0, TITLE_MAX) || "Applications";
  const email = access.check().email;
  throttle(email);

  const rows = rowsFor(ids);
  if (rows.length === 0) throw new Error("None of those applications are in the register any more.");
  const matrix = exportRows(rows, columns);

  const entry = registerEntry();
  const stamp = Utilities.formatDate(new Date(), entry.meta.tz || "Etc/GMT", "yyyy-MM-dd HH:mm");
  const created = Sheets!.Spreadsheets!.create({
    properties: { title: "CCCP export · " + title + " · " + stamp },
    sheets: [{ properties: { title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } } }],
  });
  const id = String(created.spreadsheetId || "");
  const source = loadSettings().source.sheetId;
  if (id === "" || (source !== "" && id === source)) throw new Error("The export file was not created.");
  const gid = created.sheets && created.sheets[0] && created.sheets[0].properties ? created.sheets[0].properties.sheetId : 0;

  Sheets!.Spreadsheets!.Values!.update({ values: matrix as unknown[][] }, id, "'" + SHEET_TAB + "'!A1", { valueInputOption: "RAW" });
  Sheets!.Spreadsheets!.batchUpdate({
    requests: [{
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    }],
  }, id);

  // The deployer owns the file already; sharing it with themselves is refused by Drive.
  const owner = access.ownerEmail().trim().toLowerCase();
  if (email !== "" && email.trim().toLowerCase() !== owner) {
    Drive!.Permissions!.create({ type: "user", role: "writer", emailAddress: email }, id, { sendNotificationEmail: false });
  }
  console.log(JSON.stringify({ export: "sheet", actor: email, rows: rows.length, columns: columns.map((c) => c.key), id }));
  return { id, url: String(created.spreadsheetUrl || ""), rows: rows.length };
}
