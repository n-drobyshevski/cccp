// Extracted from the author's production Apps Script apps; adapted.
// The Export menu over a table: "Export <n> rows" with CSV, Excel and, optionally, a new Google
// Sheet. It is a dropdownMenu (its gk-btn trigger and popover panel), so ship dropdownMenu.css,
// kbd.css and button.css with exportMenu.css, and mount dropdownMenuIsland so a pick closes the
// menu. CSV and Excel are built in the browser by runExport from the same rows and visible
// columns the table shows; the Sheet is the app's own RPC, so runExport only reports it.
import { html } from "@gas-kit/client/html.js";
import { fmtCount, pluralize } from "@gas-kit/client/format.js";
import { downloadBytes, downloadText } from "@gas-kit/client/download.js";
import { toCsv } from "@gas-kit/client/csv.js";
import { XLSX_MIME, buildXlsx } from "@gas-kit/client/xlsx.js";
import { dropdownMenu } from "./dropdownMenu.js";
import { exportMatrix } from "./tableModel.js";

/**
 * @component exportMenu
 * @title Export Menu
 * @category Data display
 * @summary A dropdown menu that exports the rows a table shows as a CSV file, an Excel workbook or a new Google Sheet.
 * @param {{id?: string, count: number, noun?: string, nounOne?: string, sheet?: boolean, busy?: boolean, label?: string, align?: "start"|"end"}} p
 * `id` is the menu id (default "export"; the trigger is "<id>-trigger"). `count` is the number of rows that will be exported (every filtered row, not just the page shown); the menu heading reads "Export <count> <noun>", with `noun` the plural (default "rows") and `nounOne` the singular (default "row"). `sheet` adds "New Google Sheet". `busy` disables that item and says the Sheet is being created. `label` is the trigger text (default "Export"); `align` is the panel alignment (default "end"). Every item is disabled when `count` is 0. Each item carries data-act "exportMenu:pick" and data-v "csv", "xlsx" or "sheet"; the app calls runExport(kind, { rows, columns, name, toast }) and, for "sheet", its own RPC. Ship dropdownMenu.css, kbd.css and button.css with this stylesheet, and mount dropdownMenuIsland as "dropdownMenu".
 * @emits exportMenu:pick (data-v is csv, xlsx or sheet)
 * @states default, with-sheet, empty, busy
 * @a11y A dropdownMenu: a native button trigger whose accessible name starts with its visible text and adds the count ("Export, 128 rows"), a role=menu panel with roving focus and typeahead from dropdownMenuIsland, and Escape or an outside click to close. The heading is a non-focusable label. Disabled items use the native attribute; a busy Sheet item also changes its text, so the state is never shown by dimming alone. The file extension is a muted hint after each format name. Motion as for dropdownMenu.
 * @example default: exportMenu({ id: "export", count: 128 })
 * @example with-sheet: exportMenu({ id: "export", count: 128, noun: "projects", nounOne: "project", sheet: true })
 * @example empty: exportMenu({ id: "export", count: 0, sheet: true })
 * @example busy: exportMenu({ id: "export", count: 1, sheet: true, busy: true })
 */
export function exportMenu(p) {
  const q = p || { count: 0 };
  const id = q.id != null && q.id !== "" ? String(q.id) : "export";
  const n = typeof q.count === "number" && q.count > 0 ? Math.floor(q.count) : 0;
  const noun = n === 1 ? (q.nounOne || "row") : (q.noun || "rows");
  const label = q.label != null && q.label !== "" ? String(q.label) : "Export";
  const none = n === 0;
  /** @type {Array<{type?: "item"|"label"|"separator", text?: string, act?: string, v?: string, k?: string, shortcut?: string, disabled?: boolean}>} */
  const items = [
    { type: "label", text: "Export " + fmtCount(n) + " " + noun },
    { text: "CSV file", act: "exportMenu:pick", v: "csv", k: id + "-csv", shortcut: ".csv", disabled: none },
    { text: "Excel workbook", act: "exportMenu:pick", v: "xlsx", k: id + "-xlsx", shortcut: ".xlsx", disabled: none },
  ];
  if (q.sheet) {
    items.push({ text: q.busy ? "Creating Google Sheet…" : "New Google Sheet", act: "exportMenu:pick", v: "sheet", k: id + "-sheet", disabled: none || q.busy === true });
  }
  return html`<span class="gk-exportMenu">${dropdownMenu({ id, label, items, align: q.align === "start" ? "start" : "end", ariaLabel: label + ", " + fmtCount(n) + " " + noun })}</span>`;
}

/**
 * @typedef {(message: string, more?: {kind?: "info"|"ok"|"warn"|"bad", ms?: number}) => unknown} ExportToast
 * @typedef {{ downloadText?: typeof downloadText, downloadBytes?: typeof downloadBytes }} ExportDeps
 */

/**
 * Run one export pick. For "csv" and "xlsx" it builds the file from `rows` and `columns`
 * (exportMatrix: the labels, then every row, in the order given), downloads `<name>.csv` or
 * `<name>.xlsx` (name defaults to "export"; use exportFileName from @gas-kit/client/csv.js)
 * and toasts "Downloaded <file> with <n> rows."; it returns the file name. The CSV carries one
 * byte-order mark, from toCsv. For "sheet" it returns "sheet" and does nothing else: the app
 * calls its own RPC. With no rows it toasts "Nothing to export." and returns null, as it does
 * for an unknown kind. `toast` is the app's toaster.show (createToaster); without it nothing is
 * shown. `deps` swaps the download functions in tests.
 * @internal
 * @template T
 * @param {string} kind "csv", "xlsx" or "sheet"
 * @param {{ rows: ReadonlyArray<T>, columns: ReadonlyArray<{ key?: string, label?: string, exportValue?: (row: T) => unknown, sortValue?: (row: T) => unknown }>, name?: string, sheetName?: string, toast?: ExportToast }} ctx
 * @param {ExportDeps} [deps]
 * @returns {string|null}
 */
export function runExport(kind, ctx, deps) {
  const c = ctx || { rows: [], columns: [] };
  const say = typeof c.toast === "function" ? c.toast : () => undefined;
  const rows = Array.isArray(c.rows) ? c.rows : [];
  if (kind !== "csv" && kind !== "xlsx" && kind !== "sheet") return null;
  if (!rows.length) { say("Nothing to export.", { kind: "warn" }); return null; }
  if (kind === "sheet") return "sheet";
  const d = deps || {};
  const base = c.name != null && c.name !== "" ? String(c.name) : "export";
  const matrix = exportMatrix(rows, c.columns || []);
  const file = base + "." + kind;
  if (kind === "csv") (d.downloadText || downloadText)(file, toCsv(matrix), "text/csv");
  else (d.downloadBytes || downloadBytes)(file, buildXlsx(matrix, { sheetName: c.sheetName }), XLSX_MIME);
  say("Downloaded " + file + " with " + pluralize(rows.length, "row") + ".", { kind: "ok" });
  return file;
}
