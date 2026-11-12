export type Cell = string | number | boolean | null | { $wall: string };
export interface Tab { name: string; gid: number; rows: Cell[][] }
export interface Workbook {
  id: string; name: string; tz: string; today: string; source: "synthetic" | "csv" | "inline";
  facts: {
    unmatchedId: string; duplicateId: string | null;
    textDateRow: { tab: string; id: string; header: string; text: string } | null;
    renamedHeader: string; renamedFrom: string;
  };
  tabs: Tab[];
}
export const REAL_CSV: string;
export const SYNTHETIC_CSV: string;
export const TODAY: string;
export const SHEET_ID: string;
export const SHEET_TZ: string;
export const HEADERS: Record<string, string[]>;
export function sampleCsvPath(env?: Record<string, string | undefined>): string;
export function parseCsv(text: string): string[][];
export function genWorkbook(opts?: { csvText?: string; csvPath?: string }): Workbook;
export function workbookJson(opts?: { csvText?: string; csvPath?: string }): string;
export const ONETAB_NAME: string;
export function genOneTabWorkbook(): Workbook;
