// Extracted from the author's production Apps Script apps; adapted.
// The read-only source reader. It is the ONLY module that calls SpreadsheetApp and it returns
// plain arrays. It calls no mutator, and the test fakes throw on one.
//
// A failed open or read throws one fixed ApiError (SOURCE_UNREADABLE_MESSAGE). The service's own
// text, which can carry the spreadsheet id, goes to console.error only, never to the caller (and
// so never to a viewer or the error log). The id and tab come from the app's own configuration:
// never pass one a client sent, or every caller can read any sheet the deployer can open.

import { ApiError } from "./envelope";

export const SOURCE_UNREADABLE_MESSAGE = "The source sheet could not be read.";
export const SOURCE_UNSET_MESSAGE = "No data source is configured.";

export interface SourceTable {
  header: string[];
  /** Data rows only: rows[0] is sheet row 2. Every row is padded to the header width. */
  rows: unknown[][];
  /** The spreadsheet's own time zone, which formatted every date. */
  tz: string;
  found: boolean;
}

export interface SourceHandle {
  tz: string;
  tabs: string[];
}

/** Log the service's text on the console and throw the fixed refusal instead. */
function unreadable(step: string, e: unknown): never {
  if (e instanceof ApiError) throw e;
  try {
    console.error(JSON.stringify({ source: "unreadable", step, error: String(e instanceof Error ? e.message : e).slice(0, 500) }));
  } catch {
    // best-effort
  }
  throw new ApiError("error", SOURCE_UNREADABLE_MESSAGE);
}

/** Run one source step; any throw becomes the fixed ApiError. */
function guarded<T>(step: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    return unreadable(step, e);
  }
}

function open(sheetId: unknown): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const id = typeof sheetId === "string" ? sheetId.trim() : "";
  if (!id) throw new ApiError("error", SOURCE_UNSET_MESSAGE);
  return guarded("open", () => SpreadsheetApp.openById(id));
}

export interface ReadOptions {
  /** Keep the time of day: a Date with a time becomes "yyyy-MM-dd HH:mm". Default false (date only). */
  timestamps?: boolean;
  /**
   * Project every row to these header names, in this order, after the read; the returned header
   * is this list. A name the tab does not have is kept as an all-null column, so positions always
   * match the list. A duplicated header name resolves to its first column. Cells outside the
   * projection are never formatted.
   */
  columns?: string[];
  /**
   * Read the data with getDisplayValues: every cell is the text the sheet shows (a string), a
   * blank is null, and no per-cell date formatting runs. timestamps has no effect.
   */
  display?: boolean;
}

export interface SourceRead extends SourceHandle {
  table: SourceTable;
}

/**
 * A cell as plain data: blank is null; a Date is "yyyy-MM-dd" in the spreadsheet zone (the
 * contract the client parses), or "yyyy-MM-dd HH:mm" when opts.timestamps is set and it has a
 * time. Time-only and duration cells reach Apps Script as dates on 1899-12-30; those come out as
 * "HH:mm" (never a date, so no rule mistakes them for one).
 *
 * Caveat: that HH:mm is the time in the spreadsheet zone of the 1899 instant, which carries the
 * zone's local-mean-time offset of that year, so it can be off by minutes (for example :32 or :53
 * past) from what the cell shows. For a column that holds time-only or duration cells, read the
 * displayed text with getDisplayValues instead of getValues.
 */
function plain(v: unknown, tz: string, timestamps: boolean): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (Object.prototype.toString.call(v) === "[object Date]") {
    const d = v as Date;
    if (!Number.isFinite(d.getTime())) return null;
    const stamp = Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm");
    const ymd = stamp.slice(0, 10);
    const hm = stamp.slice(11);
    // Only the time-only epoch day (and the day beside it, for zone edges), not any 1899 date.
    if (ymd === "1899-12-30" || ymd === "1899-12-31") return hm;
    return timestamps && hm !== "00:00" ? ymd + " " + hm : ymd;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return String(v);
}

/** Open the workbook and list its tabs and zone. Proves the source is reachable. */
export function openSource(sheetId: string): SourceHandle {
  const book = open(sheetId);
  return guarded("tabs", () => ({ tz: book.getSpreadsheetTimeZone(), tabs: book.getSheets().map((s) => s.getName()) }));
}

function displayCell(v: unknown): unknown {
  return v === null || v === undefined || v === "" ? null : String(v);
}

/** Read one tab of an open workbook: one header read and one data read. */
function readFrom(book: GoogleAppsScript.Spreadsheet.Spreadsheet, tz: string, tabName: string, opts: ReadOptions): SourceTable {
  const sheet = book.getSheetByName(tabName);
  const want = Array.isArray(opts.columns) ? opts.columns.map((c) => String(c)) : null;
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    return { header: want && sheet ? want : [], rows: [], tz, found: !!sheet };
  }
  const width = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const full = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]!.map((h) => String(h).trim());
  // Source column index per output column; -1 is a column the tab does not have.
  const pick: number[] = want ? want.map((name) => full.indexOf(name)) : full.map((_, i) => i);
  const header = want ?? full;
  if (lastRow < 2) return { header, rows: [], tz, found: true };
  const range = sheet.getRange(2, 1, lastRow - 1, width);
  const grid: unknown[][] = opts.display ? range.getDisplayValues() : range.getValues();
  const timestamps = !!opts.timestamps;
  const rows = grid.map((r) => {
    const out: unknown[] = new Array<unknown>(pick.length);
    for (let j = 0; j < pick.length; j++) {
      const i = pick[j]!;
      const c = i < 0 ? null : r[i];
      out[j] = opts.display ? displayCell(c) : plain(c, tz, timestamps);
    }
    return out;
  });
  return { header, rows, tz, found: true };
}

/** Read one tab. A missing tab is found:false, not a throw. */
export function readTable(sheetId: string, tabName: string, opts: ReadOptions = {}): SourceTable {
  const book = open(sheetId);
  return guarded("read", () => readFrom(book, book.getSpreadsheetTimeZone(), tabName, opts));
}

/**
 * Open the workbook ONCE and return its zone, its tab names and one tab read as readTable reads
 * it. Opening a spreadsheet takes seconds, so a caller that needs both should use this.
 */
export function readSource(sheetId: string, tabName: string, opts: ReadOptions = {}): SourceRead {
  const book = open(sheetId);
  return guarded("read", () => {
    const tz = book.getSpreadsheetTimeZone();
    const tabs = book.getSheets().map((s) => s.getName());
    return { tz, tabs, table: readFrom(book, tz, tabName, opts) };
  });
}

export const SOURCE_TAB_REFUSED_MESSAGE = "That tab is not one this app reads.";

export interface BoundSourceOptions {
  /** The source id, from the app's own configuration (a Script Property), never from a client. */
  id: () => string | null;
  /** The tabs the app may read. Absent: any tab of that one spreadsheet. */
  tabs?: () => string[];
}

/** A reader bound to one spreadsheet: it takes no id, so no caller can point it elsewhere. */
export interface BoundSource {
  openSource(): SourceHandle;
  readTable(tabName: string, opts?: ReadOptions): SourceTable;
  readSource(tabName: string, opts?: ReadOptions): SourceRead;
}

/**
 * Bind the reader to the configured id and, optionally, a tab allow-list. A tab outside the list
 * throws ApiError("error", SOURCE_TAB_REFUSED_MESSAGE) before the spreadsheet is opened.
 */
export function createSource(o: BoundSourceOptions): BoundSource {
  const id = (): string => String(o.id() ?? "");
  const tab = (name: string): string => {
    const t = String(name == null ? "" : name);
    if (o.tabs) {
      const allowed = o.tabs();
      if (!Array.isArray(allowed) || !allowed.map(String).includes(t)) throw new ApiError("error", SOURCE_TAB_REFUSED_MESSAGE);
    }
    return t;
  };
  return {
    openSource: () => openSource(id()),
    readTable: (tabName, opts = {}) => {
      const t = tab(tabName);
      return readTable(id(), t, opts);
    },
    readSource: (tabName, opts = {}) => {
      const t = tab(tabName);
      return readSource(id(), t, opts);
    },
  };
}
