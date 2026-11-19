// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// The toolbar of a data table: a search box, one facetFilter per facet, Reset while a filter is
// active, and on the right the column view options (columnChooser) and an actions slot (an
// exportMenu, an Add button). It is a pure view with no island of its own: the app mounts
// facetFilterIsland and columnChooserIsland (and dropdownMenuIsland for an exportMenu in
// `actions`) over the region, handles the acts with delegate and re-renders. Every id and data-k
// derives from `id`, so two toolbars on one page never collide.
import { html, attrs, isSafe } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { button } from "./button.js";
import { columnChooser } from "./columnChooser.js";
import { facetFilter } from "./facetFilter.js";

/** @param {unknown} x */
const has = (x) => x != null && x !== "";

/**
 * The status sentence for a match count: "12 of 60 rows match", or "12 rows match" without a
 * total; "" when `matched` is not a finite number. The toolbar renders it in its sr-only status
 * line; an app (or a controller) that keeps its own persistent live region writes the same text
 * there, since a status element replaced by a re-render is not always announced.
 * @internal
 * @param {{matched?: number|null, total?: number|null, noun?: string}} p
 * @returns {string}
 */
export function dataTableToolbarStatus(p) {
  const q = p || {};
  if (q.matched == null || !Number.isFinite(Number(q.matched))) return "";
  const noun = has(q.noun) ? String(q.noun) : "rows";
  const total = q.total != null && Number.isFinite(Number(q.total)) ? fmtCount(q.total) : "";
  return fmtCount(q.matched) + (total ? " of " + total : "") + " " + noun + " match";
}

/**
 * One item of the actions slot: SafeHtml as it is, a props object as an outline sm kit button,
 * anything else as escaped text.
 * @param {unknown} a
 */
function action(a) {
  if (a == null || a === "" || isSafe(a)) return a;
  if (typeof a === "object") return button({ variant: "outline", size: "sm", .../** @type {Record<string, any>} */ (a) });
  return String(a);
}

/**
 * @component dataTableToolbar
 * @title Data Table Toolbar
 * @category Data display
 * @summary The bar above a data table: a search box, faceted filter buttons, Reset while filtered, and column view options and actions on the right.
 * @param {{id: string, search?: {q?: string, label?: string, placeholder?: string}|null, filters?: Array<{key: string, label: string, options: Array<{value: string, label?: string, count?: number}>, selected?: string[], find?: string, big?: boolean, id?: string, k?: string, open?: boolean}>, active?: boolean, view?: {columns: Array<{key?: string, label?: string, hidden?: boolean, pinned?: boolean}>, deviations?: string[], label?: string, id?: string, k?: string}|null, actions?: unknown, matched?: number|null, total?: number|null, noun?: string}} p
 * `id` names the toolbar and prefixes every id and data-k in it (default "table-toolbar"): the search input is "<id>-search" (id and data-k), each filter gets the panel id and k "<id>-filter-<key>" (so its trigger is "<id>-filter-<key>-trigger"), the view options "<id>-view", Reset "<id>-reset" and the status line "<id>-status". A filter or the view may still pass its own `id` and `k`. `search` shows the search box with `q` as its value, `label` as its sr-only label (default "Search") and `placeholder`; leave it out for no search. `filters` are facetFilter props, one button each, in order. `active` shows Reset; when it is not a boolean the toolbar works it out (a non-blank `q` or any filter with a selection). `view` is columnChooser props (null or absent: none). `actions` is SafeHtml (an exportMenu), a kit button props object (rendered as an outline sm button) or an array of either, after the view options. `matched` and `total` (numbers) add a visually hidden role=status line, "12 of 60 rows match" (`noun`, default "rows"). The app handles dataTableToolbar:search by setting q (and page 1), dataTableToolbar:reset by clearing q and every facet, and the facetFilter and columnChooser acts as those components describe, then re-renders.
 * @emits dataTableToolbar:search (input event on the search box; read the value)
 * @emits dataTableToolbar:reset
 * @emits facetToolbar:set (data-facet, data-v; change event, from a facetFilter)
 * @emits facetList:find (data-facet; input event, from a big facetFilter)
 * @emits facetFilter:clear (data-key)
 * @emits columnChooser:toggle (change event; data-col)
 * @emits columnChooser:reset
 * @states default, active, withActions, minimal, filterOpen
 * @a11y The search box and the filter buttons sit in a role=search landmark labelled "Filter <noun>"; the search input is a native type=search input with a real (sr-only) label and a stable data-k, so renderRegion keeps focus and caret on it while the app re-renders on every keystroke. Each filter and the view options keep their own semantics (a popovertarget button with aria-haspopup="dialog" and a dialog panel; see facetFilter and columnChooser). Reset is a ghost button whose name is its visible word; its X icon is aria-hidden. Reset leaves the page when it clears the filters, so the app moves focus to the search box (data-k "<id>-search") or the first filter after a reset. With `matched` given, a visually hidden role=status line says how many rows match, so a screen reader hears the result of a search or a pick (shadcn's toolbar says nothing); dataTableToolbarStatus gives the same sentence for an app that keeps a persistent live region instead. The bar wraps: on a narrow container the search box takes the full row and the buttons flow below it.
 * @example default: dataTableToolbar({ id: "tasks", search: { q: "", label: "Search tasks", placeholder: "Filter tasks..." }, filters: [{ key: "status", label: "Status", options: [{ value: "todo", label: "Todo", count: 12 }, { value: "progress", label: "In progress", count: 5 }, { value: "done", label: "Done", count: 31 }] }, { key: "priority", label: "Priority", options: [{ value: "low", label: "Low", count: 20 }, { value: "medium", label: "Medium", count: 19 }, { value: "high", label: "High", count: 9 }] }], view: { columns: [{ key: "id", label: "Task", pinned: true }, { key: "title", label: "Title" }, { key: "status", label: "Status" }, { key: "priority", label: "Priority" }], label: "View" }, matched: 48, total: 48, noun: "tasks" })
 * @example active: dataTableToolbar({ id: "tasks-active", search: { q: "acme", label: "Search tasks", placeholder: "Filter tasks..." }, filters: [{ key: "status", label: "Status", options: [{ value: "todo", label: "Todo", count: 3 }, { value: "progress", label: "In progress", count: 1 }, { value: "done", label: "Done", count: 8 }], selected: ["todo", "progress"] }, { key: "priority", label: "Priority", options: [{ value: "low", label: "Low", count: 2 }, { value: "high", label: "High", count: 2 }] }], view: { columns: [{ key: "title", label: "Title" }, { key: "status", label: "Status" }], label: "View" }, matched: 4, total: 48, noun: "tasks" })
 * @example withActions: dataTableToolbar({ id: "invoices", search: { q: "", label: "Search invoices", placeholder: "Filter invoices..." }, filters: [{ key: "method", label: "Method", options: [{ value: "card", label: "Card", count: 14 }, { value: "transfer", label: "Transfer", count: 6 }] }], view: { columns: [{ key: "id", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "amount", label: "Amount" }], label: "View" }, actions: [{ label: "Export", act: "invoices:export", k: "invoices-export" }, { label: "New invoice", variant: "default", act: "invoices:new", k: "invoices-new" }], matched: 20, total: 20, noun: "invoices" })
 * @example minimal: dataTableToolbar({ id: "people", search: { q: "", label: "Search people", placeholder: "Search people..." } })
 * @example filterOpen: dataTableToolbar({ id: "tasks-open", search: { q: "", label: "Search tasks", placeholder: "Filter tasks..." }, filters: [{ key: "status", label: "Status", open: true, options: [{ value: "todo", label: "Todo", count: 12 }, { value: "progress", label: "In progress", count: 5 }, { value: "done", label: "Done", count: 31 }, { value: "canceled", label: "Canceled", count: 0 }], selected: ["done"] }, { key: "priority", label: "Priority", options: [{ value: "low", label: "Low", count: 20 }, { value: "high", label: "High", count: 9 }] }], active: true, view: { columns: [{ key: "title", label: "Title" }, { key: "status", label: "Status" }], label: "View" }, matched: 31, total: 48, noun: "tasks" })
 */
export function dataTableToolbar(p) {
  const q = p || { id: "table-toolbar" };
  const id = has(q.id) ? String(q.id) : "table-toolbar";
  const noun = has(q.noun) ? String(q.noun) : "rows";
  const search = q.search && typeof q.search === "object" ? q.search : null;
  const text = search && search.q != null ? String(search.q) : "";
  const filters = (Array.isArray(q.filters) ? q.filters : []).filter((f) => f && typeof f === "object");
  const active = typeof q.active === "boolean"
    ? q.active
    : text.trim() !== "" || filters.some((f) => Array.isArray(f.selected) && f.selected.some((v) => v != null && v !== ""));

  const searchBox = search
    ? html`<div class="gk-inputGroup gk-dataTableToolbar__search"><span class="gk-inputGroup__addon" data-side="start" data-kind="icon">${icon("search", 16)}</span><label class="sr-only" for="${id + "-search"}">${has(search.label) ? search.label : "Search"}</label><input ${attrs({
      type: "search", id: id + "-search", class: "gk-input gk-inputGroup__input gk-dataTableToolbar__input", autocomplete: "off",
      value: text, placeholder: has(search.placeholder) ? search.placeholder : null,
      "data-act": "dataTableToolbar:search", "data-k": id + "-search",
    })}></div>`
    : null;
  const filterButtons = filters.map((f) => {
    const fid = has(f.id) ? String(f.id) : id + "-filter-" + (has(f.key) ? String(f.key) : "facet");
    return facetFilter({ ...f, id: fid, k: has(f.k) ? String(f.k) : fid });
  });
  const reset = active
    ? button({ content: html`Reset${icon("close")}`, variant: "ghost", size: "sm", act: "dataTableToolbar:reset", k: id + "-reset" })
    : null;
  const left = searchBox || filters.length
    ? html`<div class="gk-dataTableToolbar__filters" role="search" aria-label="${"Filter " + noun}">${searchBox}${filterButtons}${reset}</div>`
    : reset ? html`<div class="gk-dataTableToolbar__filters">${reset}</div>` : null;

  const v = q.view && typeof q.view === "object" ? q.view : null;
  const vid = v && has(v.id) ? String(v.id) : id + "-view";
  const view = v ? columnChooser({ ...v, id: vid, k: has(v.k) ? String(v.k) : vid }) : null;
  const list = Array.isArray(q.actions) ? q.actions : q.actions == null ? [] : [q.actions];
  const actions = list.map(action).filter((a) => a != null && a !== "");
  const right = view || actions.length
    ? html`<div class="gk-dataTableToolbar__end">${view}${actions}</div>`
    : null;

  const status = dataTableToolbarStatus({ matched: q.matched, total: q.total, noun });
  return html`<div class="gk-dataTableToolbar"><div class="gk-dataTableToolbar__bar">${left}${right}</div>${
    status ? html`<p class="sr-only" role="status" id="${id + "-status"}">${status}</p>` : null
  }</div>`;
}
