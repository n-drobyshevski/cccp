// The ONLY module that calls SpreadsheetApp. The register Sheet is read here and nowhere
// else, and what leaves this file is plain data: strings, numbers, booleans and null. No
// Spreadsheet, Sheet or Range ever crosses the boundary, so nothing downstream can write to
// the source even by accident. test/build/staticScan.test.js holds that line.
//
// Pattern (read half only) from sidekick gas/src/server/sheetsDb.ts at commit 77bcf22 (see
// VENDOR.md). There are no writers.
//
// Dates: a date cell comes back as a Date; it is formatted in the SPREADSHEET's time zone as
// 'yyyy-MM-dd' (or 'yyyy-MM-dd HH:mm' when the time is not midnight), because a server-zone
// or UTC conversion would move a midnight date to the neighbouring day. An empty cell is null.

import type { SourceSettings, TabKey } from "../domain/types";
import { TAB_KEYS } from "../domain/types";

/** One bound tab as read: row 1 as headers, the data rows below it. */
export interface SourceTab {
  key: TabKey;
  name: string;
  /** null when the tab is not in the workbook. */
  gid: number | null;
  found: boolean;
  headers: string[];
  /** Data rows only: rows[0] is sheet row 2. */
  rows: Array<Array<string | number | boolean | null>>;
}

export interface SourceRead {
  title: string;
  url: string;
  tz: string;
  tabs: Partial<Record<TabKey, SourceTab>>;
}

type Cell = string | number | boolean | null;

const isDate = (v: unknown): v is Date => Object.prototype.toString.call(v) === "[object Date]";

/** One cell as plain data. */
function plain(v: unknown, tz: string): Cell {
  if (v === null || v === undefined || v === "") return null;
  if (isDate(v)) {
    if (isNaN(v.getTime())) return null;
    const time = Utilities.formatDate(v, tz, "HH:mm");
    return Utilities.formatDate(v, tz, time === "00:00" ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm");
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

function open(sheetId: string): GoogleAppsScript.Spreadsheet.Spreadsheet {
  if (!sheetId) throw new Error("No data source is configured.");
  try {
    return SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error("The register Sheet could not be opened: " + String(e instanceof Error ? e.message : e));
  }
}

function readSheet(
  key: TabKey, name: string, sheet: GoogleAppsScript.Spreadsheet.Sheet | null, tz: string,
): SourceTab {
  if (!sheet) return { key, name, gid: null, found: false, headers: [], rows: [] };
  const base = { key, name, gid: sheet.getSheetId(), found: true as const };
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return { ...base, headers: [], rows: [] };
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]!.map((h) => String(h ?? ""));
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).map((r) => {
    const out: Cell[] = [];
    for (let i = 0; i < width; i++) out.push(plain(r[i], tz));
    return out;
  });
  return { ...base, headers, rows };
}

/**
 * Read every bound tab: one getDataRange().getValues() each. A tab that does not exist is
 * reported (found: false), not thrown. A Sheet that cannot be opened throws one sentence.
 */
export function readTabs(source: Pick<SourceSettings, "sheetId" | "tabs">): SourceRead {
  const ss = open(source.sheetId);
  const tz = ss.getSpreadsheetTimeZone();
  const tabs: Partial<Record<TabKey, SourceTab>> = {};
  const memo = new Map<string, GoogleAppsScript.Spreadsheet.Sheet | null>();
  for (const key of TAB_KEYS) {
    const name = source.tabs[key].name;
    if (name === "") continue;
    if (!memo.has(name)) memo.set(name, ss.getSheetByName(name));
    tabs[key] = readSheet(key, name, memo.get(name) ?? null, tz);
  }
  return { title: ss.getName(), url: ss.getUrl(), tz, tabs };
}

/** What Settings needs per tab: its headers and the first non-empty value under each. */
export interface TabSample {
  found: boolean;
  headers: string[];
  examples: Record<string, string>;
}

/** Header rows and one example value per header, for the Field mapping panel. */
export function sampleTabs(source: Pick<SourceSettings, "sheetId" | "tabs">): Partial<Record<TabKey, TabSample>> {
  const read = readTabs(source);
  const out: Partial<Record<TabKey, TabSample>> = {};
  for (const key of TAB_KEYS) {
    const t = read.tabs[key];
    if (!t) continue;
    const examples: Record<string, string> = {};
    t.headers.forEach((h, i) => {
      if (h === "" || Object.prototype.hasOwnProperty.call(examples, h)) return;
      for (const r of t.rows) {
        const v = r[i];
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          examples[h] = String(v).slice(0, 120);
          break;
        }
      }
    });
    out[key] = { found: t.found, headers: t.headers, examples };
  }
  return out;
}

/** One tab of a probed workbook: its name, id, data-row count and header row. */
export interface ProbedTab {
  name: string;
  gid: number;
  rows: number;
  headers: string[];
}

export interface ProbeResult {
  title: string;
  tz: string;
  tabs: ProbedTab[];
}

/** What the workbook holds, for the owner's Probe button: every tab with its headers. Reads only. */
export function probeWorkbook(sheetId: string): ProbeResult {
  const ss = open(sheetId);
  const tabs = ss.getSheets().map((sh) => {
    const lastRow = sh.getLastRow();
    const width = sh.getLastColumn();
    const headers = lastRow < 1 || width < 1 ? [] : sh.getRange(1, 1, 1, width).getDisplayValues()[0]!.map((h) => String(h ?? ""));
    return { name: sh.getName(), gid: sh.getSheetId(), rows: Math.max(0, lastRow - 1), headers };
  });
  return { title: ss.getName(), tz: ss.getSpreadsheetTimeZone(), tabs };
}
