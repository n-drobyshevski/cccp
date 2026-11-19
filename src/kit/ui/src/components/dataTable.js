// Extracted from the author's production Apps Script apps; adapted.
// A view over tableModel output: a sticky-header table with sortable headers, a link in the
// first column, a Show more footer and empty, loading and error states, plus opt-in row selection,
// header menus, row action menus, a compact density and a footer slot. It holds no state: the
// app keeps the sort, the shown count and the selection, runs queryTable and re-renders with
// renderRegion (keepScroll restores the scroller through data-keep-scroll).
import { attrs, html, isSafe, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { icon } from "@gas-kit/client/icons.js";
import { moreStep, PAGE_STEP } from "./tableModel.js";
import { checkbox } from "./checkbox.js";
import { dropdownMenu } from "./dropdownMenu.js";

/** @param {unknown} v */
const blank = (v) => v == null || v === "" || (typeof v === "number" && v !== v);

/** @param {boolean} active @param {boolean} desc */
const sortGlyph = (active, desc) => (active ? (desc ? "▼" : "▲") : "↕");

/**
 * A header menu item's text after a muted icon.
 * @param {string} name @param {string} text
 * @returns {any}
 */
const withIcon = (name, text) => html`<span class="gk-dataTable__mi">${icon(name, 16)}</span>${text}`;

/**
 * A `k` that is not a valid prefix as one token: every character outside A-Z, a-z, 0-9 and -
 * becomes _<hex code>_. A valid `k` (a letter, then letters, digits, _ and -) is used as it is.
 * @param {unknown} s
 */
const idPart = (s) => String(s).replace(/[^A-Za-z0-9-]/g, (ch) => "_" + ch.charCodeAt(0).toString(16) + "_");

/**
 * A column key, row key or row action k as one part of an id: every character outside A-Z, a-z
 * and 0-9, the dash included, becomes _<hex code>_ ("a b" gives "a_20_b", "A-1" gives "A_2d_1").
 * The result never holds a dash, so in "<prefix>-row-<key>-trigger" the dash after the key always
 * ends it, and no key can make the id of another part (a row "a-trigger" next to a row "a", a row
 * "all" next to the select-all box). Injective: different keys give different parts.
 * @param {unknown} s
 */
const keyPart = (s) => String(s).replace(/[^A-Za-z0-9]/g, (ch) => "_" + ch.charCodeAt(0).toString(16) + "_");

/** A `k` used as the prefix as it is. */
const VALID_K = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The prefix of the new parts' ids and data-k: `k` when given (as it is when valid, so it matches
 * the ids the createDataTable controller derives from the same id), else "dt-" and the caption
 * lowercased with runs of other characters as one dash.
 * @param {{k?: string, caption?: string}} p
 */
function tableBase(p) {
  if (p.k != null && p.k !== "") return VALID_K.test(String(p.k)) ? String(p.k) : idPart(p.k);
  const slug = String(p.caption == null ? "" : p.caption).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "dt-" + (slug || "table");
}

/**
 * An href the caller built, or null when it is blank or carries an unsafe scheme.
 * @param {unknown} h
 * @returns {string|null}
 */
function safeHref(h) {
  if (!h) return null;
  return isSafeUrl(h) ? String(h) : null;
}

/**
 * @param {any} c
 * @param {{key: string|null, desc: boolean}|null|undefined} sort
 * @param {number} ci
 * @param {boolean} [loading] sort buttons are disabled while rows load
 * @param {string|null} [menuBase] with headerMenu, the id prefix of the header menus
 */
function headCell(c, sort, ci, loading, menuBase) {
  const active = !!(sort && sort.key && sort.key === c.key);
  const tipText = c.tip ? html`<span class="sr-only">. ${c.tip}</span>` : null;
  const label = c.label === "" || c.label == null ? html`<span class="sr-only">${c.srLabel || "Actions"}</span>` : c.label;
  const cls = "gk-dataTable__th" + (c.align === "end" || c.kind === "num" ? " is-end" : "") + (active ? " is-sorted" : "") + (c.sortable && c.key ? "" : " is-plain");
  if (c.sortable && c.key && menuBase && !loading) {
    const desc = !!(sort && sort.desc);
    const id = menuBase + "-col-" + keyPart(c.key);
    /** @type {any[]} */
    const items = [
      { text: withIcon("arrowUp", "Sort ascending"), act: "dataTable:sort", v: "asc", k: id + "-asc" },
      { text: withIcon("arrowDown", "Sort descending"), act: "dataTable:sort", v: "desc", k: id + "-desc" },
    ];
    if (active) items.push({ text: withIcon("arrowUpDown", "Clear sort"), act: "dataTable:sort", v: "none", k: id + "-none" });
    if (c.hideable === true) items.push({ type: "separator" }, { text: withIcon("eyeOff", "Hide column"), act: "dataTable:hide", v: c.key, k: id + "-hide" });
    const text = c.tip ? html`<span class="gk-dataTable__label" data-tip="${c.tip}">${label}</span>` : label;
    return html`<th scope="col" class="${cls + " is-menu"}" data-col="${c.key}"${active ? html` aria-sort="${desc ? "descending" : "ascending"}"` : null}>${dropdownMenu({
      id, variant: "ghost", align: c.align === "end" || c.kind === "num" ? "end" : "start", items,
      label: html`${text}${tipText}<span class="gk-dataTable__glyph is-icon" aria-hidden="true">${icon(active ? (desc ? "arrowDown" : "arrowUp") : "arrowUpDown", 14)}</span>`,
    })}</th>`;
  }
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
 * @param {{caption: string, columns: Array<{key?: string, label: string, sortable?: boolean, hideable?: boolean, align?: "start"|"end", kind?: "text"|"num"|"ell"|"status", tip?: string, srLabel?: string, render?: (row: any) => unknown}>, rows: any[], sort?: {key: string|null, desc: boolean}|null, total?: number, matched?: number, shown?: number, step?: number, href?: (row: any) => string|null|undefined, rowKey?: (row: any, i: number) => string, noun?: string, linkKey?: string, loading?: boolean, error?: string|null, emptyTitle?: string, emptyHint?: string, selection?: {selected: string[], label?: (row: any) => string}|null, headerMenu?: boolean, rowActions?: ((row: any) => Array<{type?: "item"|"checkbox"|"radio"|"separator"|"label", text?: string, act?: string, v?: string, k?: string, checked?: boolean, shortcut?: string, disabled?: boolean, destructive?: boolean}>)|null, rowLabel?: (row: any) => string, density?: "default"|"compact", footer?: unknown, k?: string, sortLabel?: string, foot?: boolean}} p
 * `rowKey` is REQUIRED whenever `href` is given: it must return a stable id for the row (not its position). It becomes the data-k of the link, and the default is the row index, so after a sort focus would be restored to whichever row now sits at that index. A blank value in the link column still renders its link, around the text "Not set", so the item stays reachable by keyboard.
 * `rows` is the visible page (queryTable().rows). `total` is the whole list, `matched` the rows that pass the filters, `shown` the rows on screen. `href` is built by the caller and used on the `linkKey` column (default: the first column that has a key; a table with no keyed column has no link).
 * The parts below are opt-in: a call without their props renders exactly what it rendered before them. Their ids and data-k start with a table prefix, `k` when given (used as it is when it is a letter then letters, digits, _ and -; any other character becomes _<hex>_), else "dt-" plus the caption lowercased with dashes ("Recent invoices" gives "dt-recent-invoices"); pass `k` when two tables on a page could share a caption. A column key, row key or item k in an id is escaped so it never holds a dash: every character outside A-Z, a-z and 0-9 becomes _<hex>_ ("a b" gives "a_20_b", "A-1" gives "A_2d_1"), so the dash after it always ends it and no key can produce another part's id.
 * `selection` (needs `rowKey`) adds a first column of kit checkboxes. The header box (id and data-k "<prefix>-select-all", sr-only label "Select all rows on this page") is checked when every row on the page is in `selected`; when only some are, its th carries data-indeterminate and dataTableIsland sets the box's `indeterminate`. Its data-v says what a click asks for: "on" (select this page) or "off" (clear this page). A row box (id and data-k "<prefix>-row-<key>-select") is labelled "Select " + `selection.label(row)` (else `rowLabel(row)`, else "row") and carries data-v = the row key; a selected row has data-state="selected". The status line adds ", n selected". Both boxes speak on "change", like columnChooser:toggle. While loading, the header box is disabled and the skeleton keeps the column.
 * `headerMenu: true` makes each sortable header a ghost dropdownMenu trigger (panel id "<prefix>-col-<key>", trigger and its data-k "<prefix>-col-<key>-trigger") with "Sort ascending", "Sort descending", "Clear sort" (only while sorted) and, for a column with `hideable: true`, "Hide column". The th keeps aria-sort and carries data-col; the trigger shows the direction as an arrowUp, arrowDown or arrowUpDown icon (the plain sort button keeps its glyphs). Items, each after a muted icon (arrowUp, arrowDown, arrowUpDown, eyeOff): dataTable:sort with data-v "asc", "desc" or "none", dataTable:hide with data-v = the column key, data-k "<panel id>-asc", "-desc", "-none", "-hide". While loading the header falls back to the plain disabled sort button. A column `tip` is a hover data-tip on the label, and sr-only text in the trigger.
 * `rowActions(row)` returns dropdownMenu items for that row; a last column (th with sr-only "Actions") gets a ghost ellipsis icon trigger with sr-only "Actions for " + `rowLabel(row)` (else the selection label, else "row"), panel id "<prefix>-row-<key>" (its trigger "<prefix>-row-<key>-trigger"). Each item gets `v` = the row key unless it sets its own, and its `k` becomes "<panel id>-item-" + (its k, else its index), escaped like a key. The row also carries data-key. An empty list draws an empty cell. The panel is a native popover in the top layer, so the scroller does not clip it.
 * `foot: false` drops the footer (the count line and Show more) for a table the app pages itself, for example with `pager` under it, and adds is-noFoot; a `footer` slot wins over it.
 * `density: "compact"` adds is-compact (tighter cells). `footer` (SafeHtml, e.g. a tablePagination) replaces the built-in foot, count and Show more included. `sortLabel` names the sorted column in the caption's sr-only "sorted by" text when `sort.key` is not among `columns` (a hidden column the rows are still sorted by); a sorted column that is shown always uses its own label. dataTableAct(el) reads col, dir and key from any of these acts.
 * @emits dataTable:sort (data-col on the plain sort button; with headerMenu data-v asc, desc or none and data-col on the th)
 * @emits dataTable:more (data-step), dataTable:clear, dataTable:retry
 * @emits dataTable:hide (data-v is the column key; data-col on the th)
 * @emits dataTable:selectAll (change event; data-v on or off)
 * @emits dataTable:select (change event; data-v is the row key)
 * @emits the act of a chosen row action item (data-v the row key unless the item sets its own, data-k)
 * @states default, sorted, filteredEmpty, empty, loading, error, allShown, selection, headerMenu, rowActions, compact, noFoot
 * @a11y An empty table (no rows match, or none yet) keeps its caption and heading row, so the columns stay named, and its body is one row whose cell spans the columns and holds the empty text as a role=status (with Clear all filters when filters hid every row); there is no footer then. Motion: each row carries data-key (rowKey, else the index); an app that redraws through swap gets data-enter on the new rows of Show more, which fade in over --dur-3 while existing rows stay put, and reduced motion keeps that fade only. Sort and Show-more buttons ease their colours over --dur-2, and the loading bars pulse slowly with a stop rule under reduced motion. A real table with a caption, th scope=col and aria-sort on the sorted column only. Sort is a button inside the th, disabled while rows load. An error message is a role=alert span, with the Retry button outside it so the announcement does not end in "Retry". The scroller is a focusable labelled region so it can be scrolled by keyboard. Blank cells read "Not set"; the counts live in a status line. Selection boxes are native checkboxes with a real (sr-only) label, so the header cell is named "Select all rows on this page" and each row box "Select <row>"; the mixed header state is the native indeterminate property (a drawn dash, not colour alone), and the selected count joins the status line. A header menu trigger and a row actions trigger are dropdownMenu buttons (aria-haspopup menu, roving focus and Escape from its island); aria-sort stays on the th; the row trigger's name includes the row label. Selected rows are tinted and their box is checked, so the state is never colour alone.
 * @example default: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name", sortable: true }, { key: "owner", label: "Owner", sortable: true }], rows: [{ id: "a1", name: "Billing", owner: "Acme" }, { id: "a2", name: "Mail", owner: null }], total: 120, matched: 120, shown: 2, href: (r) => "#/item/" + r.id, rowKey: (r) => r.id })
 * @example sorted: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name", sortable: true }], rows: [{ name: "Billing" }], sort: { key: "name", desc: true }, total: 1, matched: 1, shown: 1 })
 * @example filteredEmpty: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], total: 120, matched: 0, shown: 0 })
 * @example empty: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], total: 0, matched: 0, shown: 0 })
 * @example loading: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], loading: true })
 * @example error: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [], error: "The register could not be loaded." })
 * @example allShown: dataTable({ caption: "Apps", columns: [{ key: "name", label: "Name" }], rows: [{ name: "Billing" }], total: 1, matched: 1, shown: 1 })
 * @example selection: dataTable({ caption: "Invoices", k: "inv-sel", columns: [{ key: "id", label: "Invoice", sortable: true }, { key: "customer", label: "Customer" }, { key: "amount", label: "Amount", kind: "num" }], rows: [{ id: "INV001", customer: "Acme", amount: "250.00" }, { id: "INV002", customer: "Acme Labs", amount: "150.00" }, { id: "INV003", customer: "Acme Retail", amount: "350.00" }], rowKey: (r) => r.id, selection: { selected: ["INV002"], label: (r) => r.id }, total: 3, matched: 3, shown: 3, noun: "invoices" })
 * @example headerMenu: dataTable({ caption: "Invoices", k: "inv-menu", headerMenu: true, columns: [{ key: "id", label: "Invoice", sortable: true }, { key: "customer", label: "Customer", sortable: true, hideable: true }, { key: "amount", label: "Amount", kind: "num", sortable: true, hideable: true }], rows: [{ id: "INV003", customer: "Acme Retail", amount: "350.00" }, { id: "INV001", customer: "Acme", amount: "250.00" }], rowKey: (r) => r.id, sort: { key: "amount", desc: true }, total: 2, matched: 2, shown: 2, noun: "invoices" })
 * @example rowActions: dataTable({ caption: "Invoices", k: "inv-act", columns: [{ key: "id", label: "Invoice" }, { key: "customer", label: "Customer" }], rows: [{ id: "INV001", customer: "Acme" }, { id: "INV002", customer: "Acme Labs" }], rowKey: (r) => r.id, rowLabel: (r) => r.id, rowActions: (r) => [{ type: "label", text: "Actions" }, { text: "Copy invoice ID", act: "invoice:copy", k: "copy" }, { type: "separator" }, { text: "View customer", act: "invoice:view", k: "view" }, { text: "Delete " + r.id, act: "invoice:delete", k: "delete", destructive: true }], total: 2, matched: 2, shown: 2, noun: "invoices" })
 * @example compact: dataTable({ caption: "Apps", k: "apps-compact", density: "compact", columns: [{ key: "name", label: "Name", sortable: true }, { key: "owner", label: "Owner" }], rows: [{ id: "a1", name: "Billing", owner: "Acme" }, { id: "a2", name: "Mail", owner: "Acme Labs" }, { id: "a3", name: "Wiki", owner: "Acme" }], rowKey: (r) => r.id, selection: { selected: [] }, total: 3, matched: 3, shown: 3 })
 * @example noFoot: dataTable({ caption: "Apps", foot: false, columns: [{ key: "name", label: "Name", tip: "The name the app is listed under" }, { key: "owner", label: "Owner" }], rows: [{ name: "Billing", owner: "Acme" }, { name: "Mail", owner: "Acme" }], total: 240, matched: 240, shown: 2 })
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
  const empty = !p.loading && matched === 0;
  const firstKeyed = cols.find((c) => c.key);
  const linkKey = p.linkKey || (firstKeyed ? firstKeyed.key : undefined);
  const sort = p.sort;
  const sortedCol = sort && sort.key ? cols.find((c) => c.key === sort.key) : null;
  const sortName = sortedCol ? sortedCol.label : sort && sort.key && p.sortLabel != null && p.sortLabel !== "" ? String(p.sortLabel) : null;
  const sortSay = sortName != null ? ", sorted by " + sortName + (sort && sort.desc ? " descending" : " ascending") : "";
  const base = tableBase(p);
  const sel = p.selection && typeof p.selection === "object" ? p.selection : null;
  const acts = typeof p.rowActions === "function" ? p.rowActions : null;
  /** @param {any} r @param {number} i */
  const keyOf = (r, i) => (p.rowKey ? p.rowKey(r, i) : String(i));
  /** @param {any} r @param {((row: any) => unknown)|undefined} f */
  const nameOf = (r, f) => {
    const v = typeof f === "function" ? f(r) : null;
    return v == null || v === "" ? null : String(v);
  };
  const picked = sel ? new Set((Array.isArray(sel.selected) ? sel.selected : []).map(String)) : null;
  const pageKeys = picked && !p.loading ? rows.map((r, i) => String(keyOf(r, i))) : [];
  const onPage = picked ? pageKeys.filter((x) => picked.has(x)).length : 0;
  const all = pageKeys.length > 0 && onPage === pageKeys.length;
  const some = onPage > 0 && !all;
  const selectHead = sel ? html`<th scope="col" class="gk-dataTable__th is-plain is-select"${some ? html` data-indeterminate="true"` : null}>${checkbox({
    label: "Select all rows on this page", hideLabel: true, id: base + "-select-all", k: base + "-select-all",
    act: "dataTable:selectAll", v: all ? "off" : "on", checked: all, disabled: !!p.loading || !rows.length,
  })}</th>` : null;
  const actionsHead = acts ? html`<th scope="col" class="gk-dataTable__th is-plain is-actions"><span class="sr-only">Actions</span></th>` : null;
  const head = html`<thead><tr>${selectHead}${cols.map((c, ci) => headCell(c, sort, ci, !!p.loading, p.headerMenu === true ? base : null))}${actionsHead}</tr></thead>`;
  let body;
  if (empty) {
    // The heading row stays, so the columns are still named; the empty text spans the body.
    const filtered = total > 0;
    const span = cols.length + (sel ? 1 : 0) + (acts ? 1 : 0);
    body = html`<tbody><tr class="gk-dataTable__emptyRow"><td class="gk-dataTable__td is-empty" colspan="${Math.max(1, span)}"><div class="gk-dataTable__state" role="status"><strong>${p.emptyTitle || (filtered ? "No " + noun + " match these filters" : "No " + noun + " yet")}</strong>${
      p.emptyHint ? html`<span class="gk-dataTable__hint-text">${p.emptyHint}</span>` : null
    }${filtered ? html`<button type="button" class="gk-dataTable__btn gk-btn" data-variant="outline" data-act="dataTable:clear" data-k="table-clear">Clear all filters</button>` : null}</div></td></tr></tbody>`;
  } else if (p.loading) {
    body = html`<tbody aria-hidden="true">${[0, 1, 2, 3, 4].map(() => html`<tr class="gk-dataTable__skel">${sel ? html`<td class="gk-dataTable__td is-select"><span class="gk-dataTable__bar is-box"></span></td>` : null}${cols.map(() => html`<td class="gk-dataTable__td"><span class="gk-dataTable__bar"></span></td>`)}${acts ? html`<td class="gk-dataTable__td is-actions"></td>` : null}</tr>`)}</tbody>`;
  } else {
    body = html`<tbody>${rows.map((r, i) => {
      const key = keyOf(r, i);
      const on = !!picked && picked.has(String(key));
      const selectCell = sel ? html`<td class="gk-dataTable__td is-select">${checkbox({
        label: "Select " + (nameOf(r, sel.label) || nameOf(r, p.rowLabel) || "row"), hideLabel: true,
        id: base + "-row-" + keyPart(key) + "-select", k: base + "-row-" + keyPart(key) + "-select", act: "dataTable:select", v: String(key), checked: on,
      })}</td>` : null;
      return html`<tr class="gk-dataTable__row" data-key="${key}"${on ? html` data-state="selected"` : null}>${selectCell}${cols.map((c) => bodyCell(c, r, i, p, linkKey !== undefined && c.key === linkKey))}${acts ? actionsCell(acts, r, key, base, nameOf(r, p.rowLabel) || (sel ? nameOf(r, sel.label) : null) || "row") : null}</tr>`;
    })}</tbody>`;
  }
  const left = matched - shown;
  const step = p.step || PAGE_STEP;
  const nextStep = moreStep(shown, matched, step);
  const selSay = picked && picked.size > 0 ? ", " + fmtCount(picked.size) + " selected" : "";
  const status = (p.loading ? "Loading " + noun : (matched < total ? fmtCount(matched) + " of " + fmtCount(total) + " " + noun + " match" : fmtCount(total) + " " + noun) + (left > 0 ? ", showing " + fmtCount(shown) : ", all shown")) + selSay;
  const foot = empty ? null : p.footer != null ? html`<div class="gk-dataTable__foot is-slot">${p.footer}</div>` : p.foot === false ? null : html`<div class="gk-dataTable__foot"><span class="gk-dataTable__count" role="status">${status}</span>${
    !p.loading && left > 0 ? html`<button type="button" class="gk-dataTable__btn gk-btn" data-variant="outline" data-size="sm" data-act="dataTable:more" data-step="${nextStep}" data-k="table-more">Show ${fmtCount(nextStep)} more · ${fmtCount(left)} left</button>` : null
  }</div>`;
  return html`<div class="gk-dataTable${empty ? " is-empty" : ""}${p.loading ? " is-loading" : ""}${p.density === "compact" ? " is-compact" : ""}${p.foot === false && p.footer == null ? " is-noFoot" : ""}"${p.loading ? html` aria-busy="true"` : null}${sel ? html` data-mount="dataTable"` : null}><div class="gk-dataTable__scroll" data-keep-scroll="table" data-k="table-scroll" tabindex="0" role="region" aria-label="${p.caption}"><table class="gk-dataTable__table"><caption class="gk-dataTable__caption">${p.caption}<span class="sr-only">${sortSay}</span></caption>${head}${body}</table></div>${foot}</div>`;
}

/**
 * The row actions cell: a ghost icon trigger named "Actions for <label>" over a dropdownMenu
 * whose panel id is "<base>-row-<key>". Items get the row key as `v` unless they set their own,
 * and their `k` becomes "<panel id>-item-<k>" so it is unique per row and never the trigger's.
 * @param {(row: any) => any} acts @param {any} r @param {string} key @param {string} base @param {string} label
 */
function actionsCell(acts, r, key, base, label) {
  const id = base + "-row-" + keyPart(key);
  const got = acts(r);
  const items = (Array.isArray(got) ? got : []).filter((it) => it && typeof it === "object").map((it, n) => (
    it.type === "separator" || it.type === "label" ? it : Object.assign({}, it, { v: it.v != null ? it.v : String(key), k: id + "-item-" + keyPart(it.k != null && it.k !== "" ? it.k : String(n)) })
  ));
  if (!items.length) return html`<td class="gk-dataTable__td is-actions"></td>`;
  return html`<td class="gk-dataTable__td is-actions">${dropdownMenu({ id, variant: "ghost", align: "end", items, label: html`${icon("ellipsis", 16)}<span class="sr-only">Actions for ${label}</span>` })}</td>`;
}

/**
 * What a dataTable act is about, read from the element that carries it (the second argument of a
 * delegate handler), wherever the payload sits: `col` is the column (data-col on a sort button,
 * on the th around a header menu item, or the data-v of a Hide column item), `dir` is the
 * direction a header menu item asks for ("asc", "desc" or "none"; null for the plain sort
 * button, which cycles), and `key` is the row key (the data-v of a row checkbox, the data-key of
 * the row around a row action item). Lookups stop at the table's root.
 * @internal
 * @param {any} el
 * @returns {{act: string|null, col: string|null, dir: "asc"|"desc"|"none"|null, key: string|null, v: string|null}}
 */
export function dataTableAct(el) {
  /** @param {any} n @param {string} a @returns {string|null} */
  const get = (n, a) => (n && typeof n.getAttribute === "function" ? n.getAttribute(a) : null);
  const rootEl = el && typeof el.closest === "function" ? el.closest(".gk-dataTable") : null;
  /** @param {string} a */
  const up = (a) => {
    const n = el && typeof el.closest === "function" ? el.closest("[" + a + "]") : null;
    return n && rootEl && rootEl.contains(n) ? get(n, a) : null;
  };
  const act = get(el, "data-act");
  const v = get(el, "data-v");
  const dir = act === "dataTable:sort" && (v === "asc" || v === "desc" || v === "none") ? v : null;
  const col = act === "dataTable:hide" ? v : get(el, "data-col") || (act === "dataTable:sort" ? up("data-col") : null);
  const key = act === "dataTable:select" ? v : act === "dataTable:selectAll" || act === "dataTable:sort" || act === "dataTable:hide" ? null : up("data-key");
  return { act, col, dir, key, v };
}

/**
 * Sets the DOM `indeterminate` property of the header checkbox from data-indeterminate on its th
 * (and clears it on a header without it). Idempotent, adds no listener, so mounting it again after
 * every render of the region is safe and required.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const dataTableIsland = {
  mount(el) {
    Array.prototype.forEach.call(el.querySelectorAll(".gk-dataTable__th.is-select input"), (/** @type {any} */ box) => {
      box.indeterminate = !!(box.closest && box.closest("[data-indeterminate]"));
    });
  },
};
