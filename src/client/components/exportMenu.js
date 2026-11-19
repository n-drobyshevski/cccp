// The Export menu on the list, on the kit exportMenu (a dropdown menu: 'Export <n> applications'
// with CSV, Excel and New Google Sheet). CSV and Excel are built by the kit runExport from the same
// rows and visible columns the table shows (every filtered row, in the active sort); the Sheet is
// built by the server from ids and column keys, and its toast carries the link the server returned.
// The list page mounts dropdownMenuIsland on the menu and handles the exportMenu:pick act.
import { exportMenu, runExport as kitExport } from "@gas-kit/ui/components/exportMenu.js";
import { exportFileName } from "@gas-kit/client/csv.js";
import { fmtCount } from "@gas-kit/client/format.js";
import * as rpc from "@gas-kit/client/rpc.js";
import { toast } from "../lib/toast.js";
import { errorText } from "../lib/errorText.js";

/** The menu (trigger and panel). `n` is the number of filtered applications. */
export function exportMenuView(n) {
  return exportMenu({ id: "export", count: n, noun: "applications", nounOne: "application", sheet: true });
}

/** One kit column per export cell: Status is eight (four words, four reasons), the rest one. */
export function exportColumns(cols) {
  return cols.flatMap((c) => c.heads.map((head, i) => ({ key: c.key + ":" + i, label: head, exportValue: (r) => c.cells(r)[i] })));
}

// The kit toasts with 'bad'; the app's toast says 'err'.
const say = (message, more) => toast(message, { kind: more && more.kind === "bad" ? "err" : more && more.kind, ms: more && more.ms });

let creating = false;

/**
 * Run one export. `ctx` is {rows, cols, route, today, title}: the filtered and sorted rows and
 * the visible column definitions. Resolves when done; never rejects.
 */
export async function runExport(kind, ctx) {
  const { rows, cols } = ctx;
  if (kind === "csv" || kind === "xlsx") {
    const name = exportFileName(["cccp", ctx.route || "export", ctx.today], kind).slice(0, -(kind.length + 1));
    kitExport(kind, { rows, columns: exportColumns(cols), name, sheetName: "Applications", toast: say });
    return;
  }
  if (!rows.length) { toast("Nothing to export.", { kind: "warn" }); return; }
  if (creating) { toast("A Google Sheet is already being created."); return; }
  creating = true;
  const wait = toast("Creating a Google Sheet with " + fmtCount(rows.length) + (rows.length === 1 ? " row" : " rows") + "...", { ms: 60000 });
  try {
    const res = await rpc.call("exportToSheet", { ids: rows.map((r) => r.app.id), columns: cols.map((c) => c.key), title: ctx.title });
    wait.close();
    toast(res.shared ? "Google Sheet created, shared with you." : "Google Sheet created.", { kind: "ok", link: { href: res.url, label: "Open Sheet" }, ms: 20000 });
  } catch (e) {
    wait.close();
    toast(errorText(e, "The Google Sheet could not be created."), { kind: "err", ms: 9000 });
  } finally {
    creating = false;
  }
}

/** Test seam. */
export function __resetExportForTest() {
  creating = false;
}
