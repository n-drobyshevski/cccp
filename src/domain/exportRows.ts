// Rows x columns to a plain matrix for CSV, Excel and the Sheet export. Follows the given column
// order, starts with a label header row, expands Status to four words plus four reasons, and
// gives completeness as a number. Dates are already ISO strings on the record.

import type { Column, ExportCell } from "./columns";
import type { Row } from "./facets";

export type { ExportCell };

export function exportHeader(columns: readonly Column[]): string[] {
  return columns.flatMap((c) => c.heads);
}

export function exportRows(rows: readonly Row[], columns: readonly Column[]): ExportCell[][] {
  const out: ExportCell[][] = [exportHeader(columns)];
  for (const r of rows) out.push(columns.flatMap((c) => c.cells(r)));
  return out;
}
