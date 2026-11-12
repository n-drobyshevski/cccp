// The Export menu on the list: 'Export <n> applications' with CSV, Excel and New Google Sheet.
// CSV and Excel are built here from the same rows and visible columns the table shows (every
// filtered row, in the active sort); the Sheet is built by the server from ids and column keys,
// and its toast carries the link the server returned.
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { downloadBytes, downloadText } from "../lib/download.js";
import { num } from "../lib/format.js";
import * as rpc from "../lib/rpc.js";
import { toast } from "../lib/toast.js";
import { exportRows } from "../../domain/exportRows";
import { exportName, toCsv } from "../export/csv.js";
import { XLSX_MIME, buildXlsx } from "../export/xlsx.js";

/** The menu body. `n` is the number of filtered applications. */
export function exportMenuView(n, busy) {
  const dis = n > 0 ? "" : " disabled";
  return html`<div class="popin menu"><span class="lbl mlbl">Export ${num(n)} ${n === 1 ? "application" : "applications"}</span><button type="button" class="mitem" data-act="export-csv" data-k="export-csv"${dis}>${icon("download")}<span>CSV file</span><small>.csv</small></button><button type="button" class="mitem" data-act="export-xlsx" data-k="export-xlsx"${dis}>${icon("download")}<span>Excel workbook</span><small>.xlsx</small></button><button type="button" class="mitem" data-act="export-sheet" data-k="export-sheet"${dis || (busy ? " disabled" : "")}>${icon("sheet")}<span>New Google Sheet</span></button></div>`;
}

let creating = false;

/**
 * Run one export. `ctx` is {rows, cols, route, today, title}: the filtered and sorted rows and
 * the visible column definitions. Resolves when done; never rejects.
 */
export async function runExport(kind, ctx) {
  const { rows, cols } = ctx;
  if (!rows.length) { toast("Nothing to export.", { kind: "err" }); return; }
  if (kind === "csv" || kind === "xlsx") {
    const matrix = exportRows(rows, cols);
    const name = exportName(ctx.route, ctx.today, kind);
    if (kind === "csv") downloadText(name, toCsv(matrix), "text/csv");
    else downloadBytes(name, buildXlsx(matrix), XLSX_MIME);
    toast("Downloaded " + name + " with " + num(rows.length) + (rows.length === 1 ? " row" : " rows") + ".");
    return;
  }
  if (creating) { toast("A Google Sheet is already being created."); return; }
  creating = true;
  const wait = toast("Creating a Google Sheet with " + num(rows.length) + (rows.length === 1 ? " row" : " rows") + "...", { ms: 60000 });
  try {
    const res = await rpc.call("exportToSheet", { ids: rows.map((r) => r.app.id), columns: cols.map((c) => c.key), title: ctx.title });
    wait.close();
    toast("Google Sheet created, shared with you.", { link: { href: res.url, label: "Open Sheet" }, ms: 20000 });
  } catch (e) {
    wait.close();
    toast(e && e.message ? e.message : "The Google Sheet could not be created.", { kind: "err", ms: 9000 });
  } finally {
    creating = false;
  }
}

/** Test seam. */
export function __resetExportForTest() {
  creating = false;
}
