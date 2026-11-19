// Extracted from the author's production Apps Script apps; adapted.
// A view over tableModel output: a sticky-header table with sortable headers, a link in the
// first column, a Show more footer and empty, loading and error states. It holds no state: the
// app keeps the sort and the shown count, runs queryTable and re-renders with renderRegion
// (keepScroll restores the scroller through data-keep-scroll).
import { attrs, html, isSafe, linkAttrs } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { moreStep, PAGE_STEP } from "./tableModel.js";

/** @param {unknown} v */
const blank = (v) => v == null || v === "" || (typeof v === "number" && v !== v);

/** @param {boolean} active @param {boolean} desc */
const sortGlyph = (active, desc) => (active ? (desc ? "▼" : "▲") : "↕");

/**
 * An href the caller built, or null when it is blank or carries an unsafe scheme.
 * @param {unknown} h
 * @returns {string|null}
 */
function safeHref(h) {
  if (!h) return null;
  try { attrs({ href: h }); return String(h); } catch (e) { return null; }
}

/**
 * @param {any} c
 * @param {{key: string|null, desc: boolean}|null|undefined} sort
 * @param {number} ci
 * @param {boolean} [loading] sort buttons are disabled while rows load
 */
function headCell(c, sort, ci, loading) {
  const active = !!(sort && sort.key && sort.key === c.key);
  const tipText = c.tip ? html`<span class="sr-only">. ${c.tip}</span>` : null;
  const label = c.label === "" || c.label == null ? html`<span class="sr-only">${c.srLabel || "Actions"}</span>` : c.label;
  const cls = "gk-dataTable__th" + (c.align === "end" || c.kind === "num" ? " is-end" : "") + (active ? " is-sorted" : "") + (c.sortable && c.key ? "" : " is-plain");
  if (c.sortable && c.key) {
    return html`<th scope="col" class="${cls}"${active ? html` aria-sort="${sort && sort.desc ? "descending" : "ascending"}"` : null}><button type="button" class="gk-dataTable__sort" ${attrs({
      "data-act": "dataTable:sort", "data-col": c.key, "data-k": "sort-" + c.key, "data-tip": c.tip || null, disabled: !!loading,
    })}>${label}${tipText}<span class="gk-dataTable__glyph" aria-hidden="true">${sortGlyph(active, !!(sort && sort.desc))}</span></button></th>`;
  }
  return html`<th scope="col" class="${cls}">${c.tip ? html`<span class="gk-dataTable__hint" tabindex="0" role="note" data-k="${"hint-" + (c.key || "col" + ci)}" data-tip="${c.tip}">${label}${tipText}</span>` : label}</th>`;
}

/**
 * @param {any} c
 * @param {any} row
 * @param {number} i
 * @param {{href?: (row: any) => string|null|undefined, rowKey?: (row: any, i: number) => string}} o
 * @param {boolean} isLink
 */
function bodyCell(c, row, i, o, isLink) {
  const v = c.render ? c.render(row) : c.key ? row[c.key] : null;
  const cls = "gk-dataTable__td" + (c.align === "end" || c.kind === "num" ? " is-end num" : "") + (c.kind === "ell" ? " is-ell" : "");
  const empty = !isSafe(v) && blank(v);
  let inner = empty ? html`<span aria-hidden="true">–</span><span class="sr-only">Not set</span>` : isSafe(v) ? v : html`${String(v)}`;
  if (empty && !(isLink && o.href && safeHref(o.href(row)))) return html`<td class="${cls}">${inner}</td>`;
  if (!empty && c.kind === "status") inner = html`<span class="gk-dataTable__status">${inner}</span>`;
  if (!empty && c.kind === "ell" && !isSafe(v)) inner = html`<span class="gk-dataTable__ell" data-tip="${String(v)}">${inner}</span>`;
  const href = isLink && o.href ? safeHref(o.href(row)) : null;
  if (href) {
    const key = o.rowKey ? o.rowKey(row, i) : String(i);
    inner = html`<a class="gk-dataTable__link" ${attrs({ ...linkAttrs(href), "data-k": "row-" + key })}>${inner}</a>`;
  }
  return html`<td class="${cls}">${inner}</td>`;
}

/**
 * @component dataTable
 * @title Data Table
 * @category Data display
 * @summary A sortable, sticky-header table over a page of rows, with a link column, Show more and empty, loading and error states.
 * @param {{caption: string, columns: Array<{key?: string, label: string, sortable?: boolean, align?: "start"|"end", kind?: "text"|"num"|"ell"|"status", tip?: string, srLabel?: string, render?: (row: any) => unknown}>, rows: any[], sort?: {key: string|null, desc: boolean}|null, total?: number, matched?: number, shown?: number, step?: number, href?: (row: any) => string|null|undefined, rowKey?: (row: any, i: number) => string, noun?: string, linkKey?: string, loading?: boolean, error?: string|null, emptyTitle?: string, emptyHint?: string}} p
 * `rowKey` is REQUIRED whenever `href` is given: it must return a stable id for the row (not its position). It becomes the data-k of the link, and the default is the row index, so after a sort focus would be restored to whichever row now sits at that index. A blank value in the link column still renders its link, around the text "Not set", so the item stays reachable by keyboard.
 * `rows` is the visible page (queryTable().rows). `total` is the whole list, `matched` the rows that pass the filters, `shown` the rows on screen. `href` is built by the caller and used on the `linkKey` column (default: the first column that has a key; a table with no keyed column has no link).
 * @emits dataTable:sort (data-col), dataTable:more (data-step), dataTable:clear, dataTable:retry
 * @states default, sorted, filteredEmpty, empty, loading, error, allShown
 * @a11y Motion: each row carries data-key (rowKey, else the index); an app that redraws through swap gets data-enter on the new rows of Show more, which fade in over --dur-3 while existing rows stay put, and reduced motion keeps that fade only. Sort and Show-more buttons ease their colours over --dur-2, and the loading bars pulse slowly with a stop rule under reduced motion. A real table with a caption, th scope=col and aria-sort on the sorted column only. Sort is a button inside the th, disabled while rows load. An error message is a role=alert span, with the Retry button outside it so the announcement does not end in "Retry". The scroller is a focusable labelled region so it can be scrolled by keyboard. Blank cells read "Not set"; the counts live in a status line.
 * @example default: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name", sortable: true }, { key: "owner", label: "Owner", sortable: true }], rows: [{ id: "a1", name: "Billing", owner: "Acme" }, { id: "a2", name: "Mail", owner: null }], total: 120, matched: 120, shown: 2, href: (r) => "#/item/" + r.id, rowKey: (r) => r.id })
 * @example sorted: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name", sortable: true }], rows: [{ name: "Billing" }], sort: { key: "name", desc: true }, total: 1, matched: 1, shown: 1 })
 * @example filteredEmpty: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], total: 120, matched: 0, shown: 0 })
 * @example empty: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], total: 0, matched: 0, shown: 0 })
 * @example loading: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], loading: true })
 * @example error: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], error: "The register could not be loaded." })
 * @example allShown: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [{ name: "Billing" }], total: 1, matched: 1, shown: 1 })
 */
export function dataTable(p) {
  const noun = p.noun || "rows";
  const cols = p.columns || [];
  const rows = p.rows || [];
  if (p.error) {
    return html`<div class="gk-dataTable is-error"><div class="gk-dataTable__state"><span role="alert"><strong>Error:</strong> ${p.error}</span><button type="button" class="gk-dataTable__btn gk-btn" data-variant="outline" data-act="dataTable:retry" data-k="table-retry">Retry</button></div></div>`;
  }
  const total = p.total == null ? rows.length : p.total;
  const matched = p.matched == null ? total : p.matched;
  const shown = p.shown == null ? rows.length : p.shown;
  if (!p.loading && matched === 0) {
    const filtered = total > 0;
    return html`<div class="gk-dataTable is-empty"><div class="gk-dataTable__state" role="status"><strong>${p.emptyTitle || (filtered ? "No " + noun + " match these filters" : "No " + noun + " yet")}</strong>${
      p.emptyHint ? html`<span class="gk-dataTable__hint-text">${p.emptyHint}</span>` : null
    }${filtered ? html`<button type="button" class="gk-dataTable__btn gk-btn" data-variant="outline" data-act="dataTable:clear" data-k="table-clear">Clear all filters</button>` : null}</div></div>`;
  }
  const firstKeyed = cols.find((c) => c.key);
  const linkKey = p.linkKey || (firstKeyed ? firstKeyed.key : undefined);
  const sort = p.sort;
  const sortedCol = sort && sort.key ? cols.find((c) => c.key === sort.key) : null;
  const sortSay = sortedCol ? ", sorted by " + sortedCol.label + (sort && sort.desc ? " descending" : " ascending") : "";
  const head = html`<thead><tr>${cols.map((c, ci) => headCell(c, sort, ci, !!p.loading))}</tr></thead>`;
  let body;
  if (p.loading) {
    body = html`<tbody aria-hidden="true">${[0, 1, 2, 3, 4].map(() => html`<tr class="gk-dataTable__skel">${cols.map(() => html`<td class="gk-dataTable__td"><span class="gk-dataTable__bar"></span></td>`)}</tr>`)}</tbody>`;
  } else {
    body = html`<tbody>${rows.map((r, i) => html`<tr class="gk-dataTable__row" data-key="${p.rowKey ? p.rowKey(r, i) : String(i)}">${cols.map((c) => bodyCell(c, r, i, p, linkKey !== undefined && c.key === linkKey))}</tr>`)}</tbody>`;
  }
  const left = matched - shown;
  const step = p.step || PAGE_STEP;
  const nextStep = moreStep(shown, matched, step);
  const status = p.loading ? "Loading " + noun : (matched < total ? fmtCount(matched) + " of " + fmtCount(total) + " " + noun + " match" : fmtCount(total) + " " + noun) + (left > 0 ? ", showing " + fmtCount(shown) : ", all shown");
  return html`<div class="gk-dataTable${p.loading ? " is-loading" : ""}"${p.loading ? html` aria-busy="true"` : null}><div class="gk-dataTable__scroll" data-keep-scroll="table" data-k="table-scroll" tabindex="0" role="region" aria-label="${p.caption}"><table class="gk-dataTable__table"><caption class="gk-dataTable__caption">${p.caption}<span class="sr-only">${sortSay}</span></caption>${head}${body}</table></div><div class="gk-dataTable__foot"><span class="gk-dataTable__count" role="status">${status}</span>${
    !p.loading && left > 0 ? html`<button type="button" class="gk-dataTable__btn gk-btn" data-variant="outline" data-size="sm" data-act="dataTable:more" data-step="${nextStep}" data-k="table-more">Show ${fmtCount(nextStep)} more · ${fmtCount(left)} left</button>` : null
  }</div></div>`;
}
