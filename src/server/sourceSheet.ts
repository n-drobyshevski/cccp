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
import { LEGACY_TAB_NAMES } from "../domain/settings";

/** One bound tab as read: row 1 as headers, the data rows below it. */
export interface SourceTab {
  key: TabKey;
  name: string;
  /** null when the tab is not in the workbook. */
  gid: number | null;
  found: boolean;
  /** Applications tab only: the configured tab was not in the workbook and this one was chosen. */
  detected?: boolean;
  headers: string[];
  /** Data rows only: rows[0] is sheet row 2. */
  rows: Array<Array<string | number | boolean | null>>;
}

export interface SourceRead {
  title: string;
  url: string;
  tz: string;
  /** Every tab of the workbook, in order. */
  sheetNames: string[];
  /**
   * Bound tabs. A pillar that reads from the Applications tab (sameTab) has no entry: its data is
   * the Applications entry's.
   */
  tabs: Partial<Record<TabKey, SourceTab>>;
}

type SourceBinding = Pick<SourceSettings, "sheetId" | "tabs">;
/** The header settings readTabs needs to recognise the id column when it has to pick the tab. */
export interface ReadOptions {
  /** The Application id header (settings.fields.id.header); default "UUID". */
  idHeader?: string;
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

const normHeader = (h: unknown): string => String(h ?? "").trim().toLowerCase();

function firstRow(sheet: GoogleAppsScript.Spreadsheet.Sheet): string[] {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]!.map((h) => String(h ?? ""));
}

/**
 * The Applications tab when its configured name is not in the workbook: the first sheet whose
 * header row holds the id header (trimmed, case-insensitive), else the first sheet. null only for
 * a workbook with no sheets.
 */
function detectAppsSheet(
  sheets: GoogleAppsScript.Spreadsheet.Sheet[], idHeader: string,
): GoogleAppsScript.Spreadsheet.Sheet | null {
  const want = normHeader(idHeader);
  if (want !== "") {
    for (const sh of sheets) if (firstRow(sh).some((h) => normHeader(h) === want)) return sh;
  }
  return sheets[0] ?? null;
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
export function readTabs(source: SourceBinding, opts: ReadOptions = {}): SourceRead {
  const ss = open(source.sheetId);
  const tz = ss.getSpreadsheetTimeZone();
  const tabs: Partial<Record<TabKey, SourceTab>> = {};
  const memo = new Map<string, GoogleAppsScript.Spreadsheet.Sheet | null>();
  const sheets = ss.getSheets();
  for (const key of TAB_KEYS) {
    const b = source.tabs[key];
    if (key !== "apps" && b.sameTab) continue;
    if (b.name === "") continue;
    if (!memo.has(b.name)) memo.set(b.name, ss.getSheetByName(b.name));
    const sheet = memo.get(b.name) ?? null;
    if (key === "apps" && !sheet) {
      // The configured tab is not there (including the untouched default "Apps"): detect it.
      const found = detectAppsSheet(sheets, opts.idHeader ?? "UUID");
      tabs[key] = found ? { ...readSheet(key, found.getName(), found, tz), detected: true } : readSheet(key, b.name, null, tz);
    } else tabs[key] = readSheet(key, b.name, sheet, tz);
  }
  return { title: ss.getName(), url: ss.getUrl(), tz, sheetNames: sheets.map((sh) => sh.getName()), tabs };
}

/** What Settings needs per tab: its headers and the first non-empty value under each. */
export interface TabSample {
  found: boolean;
  headers: string[];
  examples: Record<string, string>;
}

/** Header rows and one example value per header, for the Field mapping panel. */
export function sampleTabs(source: SourceBinding, opts: ReadOptions = {}): Partial<Record<TabKey, TabSample>> {
  return sampleWorkbook(source, opts).tabs;
}

/** sampleTabs plus the workbook's tab names. A same-tab pillar is sampled as the Applications tab. */
export function sampleWorkbook(source: SourceBinding, opts: ReadOptions = {}): { tabs: Partial<Record<TabKey, TabSample>>; tabNames: string[] } {
  const read = readTabs(source, opts);
  const out: Partial<Record<TabKey, TabSample>> = {};
  for (const key of TAB_KEYS) {
    const b = source.tabs[key];
    // Settings saved before the same-tab default: an absent old default tab reads as the Applications tab.
    const legacy = key !== "apps" && !b.sameTab && b.name === LEGACY_TAB_NAMES[key] && !read.sheetNames.includes(b.name);
    const t = key !== "apps" && (b.sameTab || legacy) ? read.tabs.apps : read.tabs[key];
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
  return { tabs: out, tabNames: read.sheetNames };
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
