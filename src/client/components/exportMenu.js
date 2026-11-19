// The Export menu on the list: 'Export <n> applications' with CSV, Excel and New Google Sheet.
// CSV and Excel are built here from the same rows and visible columns the table shows (every
// filtered row, in the active sort); the Sheet is built by the server from ids and column keys,
// and its toast carries the link the server returned.
import { attrs, html } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { downloadBytes, downloadText } from "@gas-kit/client/download.js";
import { fmtCount } from "@gas-kit/client/format.js";
import * as rpc from "../lib/rpc.js";
import { toast } from "../lib/toast.js";
import { exportRows } from "../../domain/exportRows";
import { exportFileName, toCsv } from "@gas-kit/client/csv.js";
import { XLSX_MIME, buildXlsx } from "@gas-kit/client/xlsx.js";

/** The menu body. `n` is the number of filtered applications. */
export function exportMenuView(n, busy) {
  const dis = n > 0 ? "" : attrs({ disabled: true });
  return html`<div class="popin menu"><span class="lbl mlbl">Export ${fmtCount(n)} ${n === 1 ? "application" : "applications"}</span><button type="button" class="mitem" data-act="export-csv" data-k="export-csv" ${dis}>${icon("download")}<span>CSV file</span><small>.csv</small></button><button type="button" class="mitem" data-act="export-xlsx" data-k="export-xlsx" ${dis}>${icon("download")}<span>Excel workbook</span><small>.xlsx</small></button><button type="button" class="mitem" data-act="export-sheet" data-k="export-sheet" ${dis || (busy ? attrs({ disabled: true }) : "")}>${icon("table")}<span>New Google Sheet</span></button></div>`;
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
    const name = exportFileName(["cccp", ctx.route || "export", ctx.today], kind);
    if (kind === "csv") downloadText(name, toCsv(matrix), "text/csv");
    else downloadBytes(name, buildXlsx(matrix, { sheetName: "Applications" }), XLSX_MIME);
    toast("Downloaded " + name + " with " + fmtCount(rows.length) + (rows.length === 1 ? " row" : " rows") + ".");
    return;
  }
  if (creating) { toast("A Google Sheet is already being created."); return; }
  creating = true;
  const wait = toast("Creating a Google Sheet with " + fmtCount(rows.length) + (rows.length === 1 ? " row" : " rows") + "...", { ms: 60000 });
  try {
    const res = await rpc.call("exportToSheet", { ids: rows.map((r) => r.app.id), columns: cols.map((c) => c.key), title: ctx.title });
    wait.close();
    toast(res.shared ? "Google Sheet created, shared with you." : "Google Sheet created.", { link: { href: res.url, label: "Open Sheet" }, ms: 20000 });
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
