// The data-table alternative for a chart: the same props a chart takes, rendered as a real table.
// Pure and DOM-free; paging reuses the pager component, so the app owns the page number.
import { html, attrs } from "@gas-kit/client/html.js";
import { catText, nameOf, rowsOf, seriesOf, valueFmt } from "./chartParts.js";
import { collapsible } from "./collapsible.js";
import { pager } from "./pager.js";

const DASH = "—";

/**
 * The table's cells as strings, one model row per chart row, in order (no filtering, no sorting).
 * A missing or non-numeric value prints an em dash, never a confident zero.
 * @internal
 * @param {any} p chart props
 * @returns {{head: string[], rows: string[][]}}
 */
export function chartTableModel(p) {
  const q = p || {};
  const fmt = valueFmt(typeof q.format === "function" || typeof q.format === "string" ? { valueFormat: q.format } : q);
  const series = seriesOf(q);
  const cell = (/** @type {unknown} */ v) => (v == null || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? DASH : fmt(Number(v)));
  return {
    head: [String(q.xLabel || q.xKey || ""), ...series.map((s) => s.label)],
    rows: rowsOf(q).map((r) => [catText(q, r[q.xKey]), ...series.map((s) => cell(r[s.key]))]),
  };
}

/**
 * @typedef {{data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string}>, caption?: string, title?: string, xLabel?: string, format?: ((v: number) => string)|"number"|"percent"|"compact", valueFormat?: ((v: number) => string)|"number"|"percent"|"compact", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact", pageSize?: number, page?: number, k?: string, emptyText?: string}} ChartTableProps
 */

/**
 * @component chartTable
 * @title Chart Table
 * @category Charts
 * @summary The figures behind a chart as a real table, built from the same props the chart takes; long data is paged.
 * @param {ChartTableProps} p
 * Pass the very same `data`, `xKey` and `series` you give the chart, so the two cannot disagree. `format` (or `valueFormat`) formats the numbers; `xFormat` the first column. When there are more rows than `pageSize` (default 10) the numbered pager is shown below; the app owns `page` (1-based) and re-renders on the pager:page act (data-page is the target). The pager states the total, so a page is never mistaken for the whole. A missing value prints an em dash. Dispatch: the wrapper carries `data-table` (the `k`), so a handler reads `el.closest(".gk-chartTable").dataset.table`. The pager keys are global, so keep one paged table per region.
 * @emits pager:page (data-page is the target page)
 * @states default, paged, empty
 * @a11y A real table with a caption, column headers with scope=col and each row labelled by a scope=row header. Numbers are right aligned with tabular figures. It shows the numbers in text, so nothing is colour alone. The wrapper scrolls sideways when narrow and is focusable (tabindex 0) so a keyboard can scroll it.
 * @example default: chartTable({ caption: "Visitors by month", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", xLabel: "Month", series: [{ key: "d", label: "Desktop" }, { key: "mo", label: "Mobile" }], k: "ct-a" })
 * @example paged: chartTable({ caption: "Orders per day", data: Array.from({ length: 25 }, (_, i) => ({ d: "Day " + (i + 1), n: i * 7 })), xKey: "d", series: [{ key: "n", label: "Orders" }], pageSize: 10, page: 2, k: "ct-b" })
 * @example empty: chartTable({ caption: "Visitors by month", data: [], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "ct-c" })
 */
export function chartTable(p) {
  const q = p || /** @type {any} */ ({});
  const model = chartTableModel(q);
  const caption = q.caption || nameOf(q, "Chart data");
  const total = model.rows.length;
  if (!total || model.head.length < 2) {
    return html`<p class="gk-chartTable__empty" role="status">${q.emptyText || "This chart has no points to list."}</p>`;
  }
  const size = Math.max(1, Math.round(Number(q.pageSize)) || 10);
  const count = Math.max(1, Math.ceil(total / size));
  const page = Math.min(count, Math.max(1, Math.round(Number(q.page)) || 1));
  const shown = model.rows.slice((page - 1) * size, page * size);
  const key = q.k || "chart";
  const table = html`<div ${attrs({ class: "gk-chartTable__wrap", tabindex: "0", role: "region", "aria-label": caption, "data-k": key + "-tbl", "data-keep-scroll": true })}><table class="gk-chartTable__table"><caption>${caption}</caption><thead><tr>${model.head.map((h, i) => html`<th scope="col" class="${i ? "is-num" : ""}">${h}</th>`)}</tr></thead><tbody>${shown.map((r) => html`<tr>${r.map((c, i) => (i ? html`<td class="is-num">${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`)}</tbody></table></div>`;
  const nav = total > size ? pager({ variant: "numbered", total, page, pageSize: size, noun: "rows" }) : "";
  return html`<div class="gk-chartTable" data-table="${key}">${table}${nav}</div>`;
}

/**
 * @component chartTableToggle
 * @title Chart Table Toggle
 * @category Charts
 * @summary A chart with a "Show as table" disclosure under it, so the figures are one keypress away.
 * @param {ChartTableProps & {chart: unknown, summary?: string, open?: boolean}} p
 * `chart` is the already built chart (SafeHtml); the remaining props are the chart's own, passed again, and go to chartTable. It composes the kit collapsible, so no chart component changes. The open state lives in the browser and a re-render resets it to `open`. Paging happens only while the disclosure is open, so when the app handles pager:page it must re-render with `open: true` (and `page`), or the table closes and focus is lost.
 * @emits pager:page (data-page is the target page)
 * @states closed, open
 * @a11y Native details and summary (see collapsible): focusable, Enter and Space toggle, announced as expanded or collapsed. The table inside follows chartTable.
 * @example closed: chartTableToggle({ chart: "Chart goes here", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], caption: "Visitors by month", k: "ctt-a" })
 * @example open: chartTableToggle({ chart: "Chart goes here", open: true, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], caption: "Visitors by month", k: "ctt-b" })
 */
export function chartTableToggle(p) {
  const q = p || /** @type {any} */ ({ chart: "" });
  return html`${q.chart != null ? q.chart : ""}${collapsible({ summary: q.summary || "Show as table", open: q.open === true, k: (q.k || "chart") + "-tbl-toggle", content: chartTable(q) })}`;
}
