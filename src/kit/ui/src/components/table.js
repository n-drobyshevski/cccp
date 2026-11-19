// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A plain semantic table: caption, header row, body rows and an optional footer row. It holds
// no state and does no sorting or paging (that is dataTable). The class gk-table is shared, so a
// raw table element with class="gk-table" gets the same look.
import { html, attrs, isSafe } from "@gas-kit/client/html.js";

/**
 * A cell's content: SafeHtml passes through, null and undefined render nothing, anything else is
 * escaped text.
 * @param {unknown} v
 */
const cell = (v) => (isSafe(v) ? v : v == null ? "" : String(v));

/**
 * The alignment class of a column: "is-num" (right, tabular figures) or "is-end" (right).
 * @param {{align?: string, kind?: string}} c
 */
const alignClass = (c) => (c.kind === "num" ? "is-num" : c.align === "end" ? "is-end" : null);

/**
 * @component table
 * @title Table
 * @category Data display
 * @summary A plain table with a caption, a header row, body rows and an optional footer row; no sorting or paging.
 * @param {{caption: string, captionVisible?: boolean, columns: Array<{key: string, label: string, align?: "start"|"end", kind?: "text"|"num", tip?: string, render?: (row: any) => unknown}>, rows: any[], footer?: Array<unknown>|null, empty?: string, k?: string}} p
 * Each body cell renders `row[key]` as escaped text, or the column's `render(row)` (SafeHtml from html, or text). `kind: "num"` right-aligns the column with tabular figures; `align: "end"` right-aligns it only. `footer` is one value per column (text or SafeHtml; null leaves the cell blank) drawn as a tfoot row. With no rows the body is one full-width muted row reading `empty` (default "No rows."). The caption is screen-reader only unless `captionVisible`, which shows it muted under the table. `k` becomes the data-keep-scroll id of the scroll wrapper, so renderRegion keeps its horizontal scroll, and prefixes the data-k of the header tips. A column `tip` (the column's definition) makes its header text a focusable note with that `data-tip` and the same words as sr-only text; its data-k is `hint-<key>` (`<k>-hint-<key>` with `k`). The shared classes: `gk-table-wrap` (the overflow-x scroller) and `gk-table`, so a raw table element with class="gk-table" gets the whole look; on it, `is-num` and `is-end` on a th or td align the column.
 * @emits none
 * @states default, footer, empty, visible-caption, header-tips
 * @a11y A real table: a caption (always present, visible or sr-only) names it, header cells are th scope=col, and the footer is a tfoot row. Alignment never carries meaning. The empty row spans every column so it is read as one cell. A header tip is a tab stop (tabindex 0, role=note) so the definition shows on keyboard focus as on hover, and it is also read as text, so nothing depends on hover. Motion: the row hover background eases over --dur-2.
 * @example default: table({ caption: "Recent invoices", columns: [{ key: "id", label: "Invoice" }, { key: "status", label: "Status" }, { key: "method", label: "Method" }, { key: "amount", label: "Amount", kind: "num" }], rows: [{ id: "INV001", status: "Paid", method: "Credit card", amount: "$250.00" }, { id: "INV002", status: "Pending", method: "Bank transfer", amount: "$150.00" }, { id: "INV003", status: "Unpaid", method: "Credit card", amount: "$350.00" }] })
 * @example footer: table({ caption: "Acme invoices this month", captionVisible: true, columns: [{ key: "id", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "amount", label: "Amount", kind: "num" }], rows: [{ id: "INV004", customer: "Acme Ltd", amount: "$450.00" }, { id: "INV005", customer: "Acme Labs", amount: "$550.00" }], footer: ["Total", null, "$1,000.00"] })
 * @example empty: table({ caption: "Open invoices", columns: [{ key: "id", label: "Invoice" }, { key: "amount", label: "Amount", kind: "num" }], rows: [], empty: "No open invoices." })
 * @example visible-caption: table({ caption: "Team members at Acme", captionVisible: true, columns: [{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "seats", label: "Seats", align: "end" }], rows: [{ name: "Ada Example", email: "ada@example.org", seats: 3 }, { name: "Sam Example", email: "sam@example.org", seats: 1 }] })
 * @example header-tips: table({ caption: "Open invoices", k: "inv", columns: [{ key: "id", label: "Invoice" }, { key: "age", label: "Age", kind: "num", tip: "Days since the invoice was sent" }], rows: [{ id: "INV006", age: 12 }, { id: "INV007", age: 3 }] })
 */
export function table(p) {
  const q = p || { caption: "", columns: [], rows: [] };
  const cols = Array.isArray(q.columns) ? q.columns : [];
  const rows = Array.isArray(q.rows) ? q.rows : [];
  const footer = Array.isArray(q.footer) ? q.footer : null;
  const empty = q.empty != null && q.empty !== "" ? q.empty : "No rows.";
  const span = String(Math.max(1, cols.length));
  const kp = q.k != null && q.k !== "" ? q.k + "-" : "";
  const headText = (/** @type {any} */ c, /** @type {number} */ i) => (c.tip != null && c.tip !== ""
    ? html`<span ${attrs({ class: "gk-table__hint", tabindex: "0", role: "note", "data-k": kp + "hint-" + (c.key != null && c.key !== "" ? c.key : "col" + i), "data-tip": String(c.tip) })}>${cell(c.label)}<span class="sr-only">. ${String(c.tip)}</span></span>`
    : cell(c.label));
  const head = html`<thead><tr>${cols.map((c, i) => html`<th ${attrs({ scope: "col", class: alignClass(c) })}>${headText(c, i)}</th>`)}</tr></thead>`;
  const body = rows.length
    ? html`<tbody>${rows.map((r) => html`<tr>${cols.map((c) => html`<td ${attrs({ class: alignClass(c) })}>${cell(c.render ? c.render(r) : r == null || c.key == null ? null : r[c.key])}</td>`)}</tr>`)}</tbody>`
    : html`<tbody><tr class="gk-table__empty"><td colspan="${span}">${empty}</td></tr></tbody>`;
  const foot = footer
    ? html`<tfoot><tr>${cols.map((c, i) => html`<td ${attrs({ class: alignClass(c) })}>${cell(footer[i])}</td>`)}</tr></tfoot>`
    : null;
  return html`<div ${attrs({ class: "gk-table-wrap", "data-keep-scroll": q.k || null })}><table class="gk-table"><caption ${attrs({
    class: q.captionVisible === true ? "gk-table__caption" : "sr-only",
  })}>${cell(q.caption)}</caption>${head}${body}${foot}</table></div>`;
}
