// The data table controller: one state (search text, facet selections, sort, page, page size,
// column visibility, row selection, the open filter panel and each filter's find text) over the
// data table parts (dataTableToolbar with facetFilter and columnChooser, dataTable, and
// tablePagination as its footer). Every state change is a pure reduceTable step; the controller
// persists q, facets, sort and page in the URL hash (other params untouched) and the column
// choice and page size in the app's wrapped storage, then redraws. It is not a component: it
// has no markup of its own beyond the composition, and mount() is the one place it touches the
// DOM (renderRegion, delegate, mountIslands and a hashchange listener, all removed by its
// teardown). An app gets a full data table from a few lines:
//
//   const table = createDataTable({ id: "invoices", caption: "Invoices", noun: "invoices",
//     columns, rows: () => app.items(), rowKey: "id", facets: [{ key: "status", label: "Status" }],
//     selection: true, persist: { hash: "", storage: app.storage } });
//   const off = table.mount(el);
//   // new data: table.refresh(); leaving the page: off()
import { fmtCount } from "@gas-kit/client/format.js";
import { html } from "@gas-kit/client/html.js";
import { delegate, quote, renderRegion } from "@gas-kit/client/dom.js";
import { mountIslands } from "@gas-kit/client/islands.js";
import { buildHash, parseHash } from "@gas-kit/client/url.js";
import { columnChooserIsland, readColumns, writeColumns } from "./columnChooser.js";
import { dataTable, dataTableAct, dataTableIsland } from "./dataTable.js";
import { dataTableToolbar, dataTableToolbarStatus } from "./dataTableToolbar.js";
import { dropdownMenuIsland } from "./dropdownMenu.js";
import { facetFilterIsland } from "./facetFilter.js";
import { checkFacetKeys, facetsFromParams, toggleFacetValue } from "./facetToolbar.js";
import { tablePagination } from "./tablePagination.js";
import {
  compareValues, countBy, cycleSort, facetCountsFor, filterRows, isHideable, parseDeviations, queryTable, setKeys, toggleColumn, toggleKey, visibleColumns,
} from "./tableModel.js";

/**
 * @typedef {{ key: string|null, desc: boolean }} TableSort
 * @typedef {{ q: string, facets: Record<string, string[]>, sort: TableSort, page: number, pageSize: number, columns: string[], selected: string[], finds: Record<string, string>, open: string|null }} TableState
 * @typedef {{ key?: string, label?: string, pinned?: boolean, hidden?: boolean, hideable?: boolean, sortable?: boolean, descFirst?: boolean, sortValue?: (row: any) => unknown, exportValue?: (row: any) => unknown, [more: string]: any }} TableColumn
 * @typedef {{ columns: TableColumn[], facetKeys: string[], sortKeys: string[], descFirst?: string[], pageCount?: number, defaults?: { sort?: TableSort|null, pageSize?: number } }} TableContext
 * @typedef {{ type: "search", q: unknown }
 *   | { type: "facet", key: unknown, value: unknown }
 *   | { type: "facetClear", key: unknown }
 *   | { type: "find", key: unknown, text: unknown }
 *   | { type: "reset" }
 *   | { type: "sort", col: unknown, dir?: "asc"|"desc"|"none"|null }
 *   | { type: "hide", col: unknown }
 *   | { type: "toggleColumn", col: unknown }
 *   | { type: "resetColumns" }
 *   | { type: "select", key: unknown }
 *   | { type: "selectAll", on: boolean, keys: unknown[] }
 *   | { type: "clearSelection" }
 *   | { type: "page", page: unknown }
 *   | { type: "pageSize", size: unknown }
 *   | { type: "open", key: unknown }
 *   | { type: "set", patch: Partial<TableState>|null|undefined }} TableAction
 */

/** The params a facet key may not use: the search text, the Clear all key, the sort and the page. */
const RESERVED = ["sort", "page"];
/** The hash value of an explicit "no sort" when the table has a default sort. */
const UNSORTED = "~";
/** The largest page size accepted from a select, the storage or setState. */
const MAX_PAGE_SIZE = 10000;
/** How long the live region waits for typing to settle before it speaks, in ms. */
const ANNOUNCE_MS = 400;

/**
 * The hash prefixes of the mounted tables, per window, with the id and region of the table holding
 * each: two tables on one prefix would read and write the same params, so the second mount throws
 * while the first is mounted and its region is still in the same document (a table whose region
 * was removed without its teardown no longer counts).
 * @type {WeakMap<object, Map<string, { id: string, region: Element }>>}
 */
const mountedPrefixes = new WeakMap();

/** @param {unknown} x */
const has = (x) => x != null && x !== "";
/** A whole number in [min, max], else null. @param {unknown} v @param {number} min @param {number} max */
function whole(v, min, max) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.floor(n);
  return r >= min && r <= max ? r : null;
}
/** @param {TableSort|null|undefined} a @param {TableSort|null|undefined} b */
const sameSort = (a, b) => (a ? a.key : null) === (b ? b.key : null) && !!(a && a.key && a.desc) === !!(b && b.key && b.desc);

/**
 * A sort limited to the sortable keys: anything else is unsorted.
 * @param {unknown} s @param {string[]} sortKeys
 * @returns {TableSort}
 */
function cleanSort(s, sortKeys) {
  const v = /** @type {any} */ (s);
  if (v && typeof v === "object" && typeof v.key === "string" && sortKeys.indexOf(v.key) >= 0) return { key: v.key, desc: !!v.desc };
  return { key: null, desc: false };
}

/**
 * Facet selections limited to the known facet keys: each a list of unique, non-blank strings;
 * empty facets dropped.
 * @param {unknown} f @param {string[]} facetKeys
 * @returns {Record<string, string[]>}
 */
function cleanFacets(f, facetKeys) {
  /** @type {Record<string, string[]>} */
  const out = {};
  const src = f && typeof f === "object" ? /** @type {Record<string, unknown>} */ (f) : {};
  for (const k of facetKeys) {
    const list = src[k];
    if (!Array.isArray(list)) continue;
    /** @type {string[]} */
    const vals = [];
    for (const x of list) {
      const s = x == null ? "" : String(x);
      if (s !== "" && vals.indexOf(s) < 0) vals.push(s);
    }
    if (vals.length) out[k] = vals;
  }
  return out;
}

/** @param {unknown} list @returns {string[]} */
function cleanKeys(list) {
  /** @type {string[]} */
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (x == null) continue;
    const s = String(x);
    if (out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/**
 * Apply one action to the table state and return the next state, or the SAME object when the
 * action changes nothing (an unknown facet, column or act, a page out of range), so a caller can
 * skip the redraw. Pure: no DOM, no storage, inputs never mutated.
 *
 * - search, facet (toggle one value), facetClear and reset change what matches, so they go back
 *   to page 1; reset clears q, every facet and every find text and keeps the sort, the columns
 *   and the selection (as shadcn's Reset does).
 * - sort with no `dir` cycles the column (cycleSort; a column with `descFirst` starts
 *   descending); `dir` "asc" or "desc" sets it, "none" clears it (only when that column is the
 *   sorted one). A sort change goes back to page 1.
 * - hide hides a visible hideable column; toggleColumn flips one (toggleColumn of tableModel);
 *   resetColumns drops every deviation.
 * - select toggles one row key; selectAll sets (`on`) or clears the given keys (the page);
 *   selection survives paging, sorting and filtering.
 * - page sets a page in 1..ctx.pageCount; pageSize sets a positive whole size and keeps the
 *   first row of the current page on screen.
 * - find sets the find text of a big facet; open names the facet whose filter panel is open.
 * - set merges a patch of state fields, each cleaned; a patch that changes q or facets without
 *   a page goes back to page 1.
 * @internal
 * @param {TableState} state
 * @param {TableAction} action
 * @param {TableContext} ctx
 * @returns {TableState}
 */
export function reduceTable(state, action, ctx) {
  const s = state;
  const a = /** @type {any} */ (action) || {};
  const facetKeys = ctx.facetKeys || [];
  const sortKeys = ctx.sortKeys || [];
  const columns = ctx.columns || [];
  /** @param {Partial<TableState>} patch */
  const next = (patch) => Object.assign({}, s, patch);
  switch (a.type) {
    case "search": {
      const q = a.q == null ? "" : String(a.q);
      return q === s.q ? s : next({ q, page: 1 });
    }
    case "facet": {
      const key = String(a.key);
      if (facetKeys.indexOf(key) < 0 || !has(a.value)) return s;
      return next({ facets: toggleFacetValue(s.facets, key, String(a.value)), page: 1 });
    }
    case "facetClear": {
      const key = String(a.key);
      if (!s.facets[key]) return s;
      const facets = Object.assign({}, s.facets);
      delete facets[key];
      return next({ facets, page: 1 });
    }
    case "find": {
      const key = String(a.key);
      if (facetKeys.indexOf(key) < 0) return s;
      const text = a.text == null ? "" : String(a.text);
      if ((s.finds[key] || "") === text) return s;
      const finds = Object.assign({}, s.finds);
      if (text) finds[key] = text; else delete finds[key];
      return next({ finds });
    }
    case "reset": {
      if (s.q === "" && !Object.keys(s.facets).length && !Object.keys(s.finds).length && s.page === 1) return s;
      return next({ q: "", facets: {}, finds: {}, page: 1 });
    }
    case "sort": {
      const col = String(a.col);
      if (sortKeys.indexOf(col) < 0) return s;
      /** @type {TableSort} */
      let sort;
      if (a.dir === "asc" || a.dir === "desc") sort = { key: col, desc: a.dir === "desc" };
      else if (a.dir === "none") {
        if (s.sort.key !== col) return s;
        sort = { key: null, desc: false };
      } else sort = cycleSort(s.sort, col, { descFirst: (ctx.descFirst || []).indexOf(col) >= 0 });
      return sameSort(sort, s.sort) ? s : next({ sort, page: 1 });
    }
    case "hide": {
      const col = String(a.col);
      const c = columns.find((x) => x.key === col);
      if (!c || !isHideable(c) || !visibleColumns(columns, s.columns).some((x) => x.key === col)) return s;
      return next({ columns: toggleColumn(columns, s.columns, col) });
    }
    case "toggleColumn": {
      const col = String(a.col);
      const c = columns.find((x) => x.key === col);
      if (!c || !isHideable(c)) return s;
      return next({ columns: toggleColumn(columns, s.columns, col) });
    }
    case "resetColumns":
      return s.columns.length ? next({ columns: [] }) : s;
    case "select":
      return a.key == null || a.key === "" ? s : next({ selected: toggleKey(s.selected, String(a.key)) });
    case "selectAll": {
      const selected = setKeys(s.selected, cleanKeys(a.keys), !!a.on);
      return selected.length === s.selected.length && selected.every((k, i) => k === s.selected[i]) ? s : next({ selected });
    }
    case "clearSelection":
      return s.selected.length ? next({ selected: [] }) : s;
    case "page": {
      const max = ctx.pageCount == null ? MAX_PAGE_SIZE * MAX_PAGE_SIZE : Math.max(1, ctx.pageCount);
      const page = whole(a.page, 1, max);
      return page == null || page === s.page ? s : next({ page });
    }
    case "pageSize": {
      const size = whole(a.size, 1, MAX_PAGE_SIZE);
      if (size == null || size === s.pageSize) return s;
      const first = (s.page - 1) * s.pageSize;
      return next({ pageSize: size, page: Math.floor(first / size) + 1 });
    }
    case "open": {
      const key = a.key == null || a.key === "" ? null : String(a.key);
      if (key !== null && facetKeys.indexOf(key) < 0) return s;
      return key === s.open ? s : next({ open: key });
    }
    case "set": {
      const p = /** @type {any} */ (a.patch && typeof a.patch === "object" ? a.patch : {});
      /** @type {Partial<TableState>} */
      const out = {};
      if ("q" in p) out.q = p.q == null ? "" : String(p.q);
      if ("facets" in p) out.facets = cleanFacets(p.facets, facetKeys);
      if ("sort" in p) out.sort = cleanSort(p.sort, sortKeys);
      if ("pageSize" in p) { const n = whole(p.pageSize, 1, MAX_PAGE_SIZE); if (n != null) out.pageSize = n; }
      if ("page" in p) { const n = whole(p.page, 1, MAX_PAGE_SIZE * MAX_PAGE_SIZE); if (n != null) out.page = n; }
      if ("columns" in p) out.columns = parseDeviations(p.columns, columns);
      if ("selected" in p) out.selected = cleanKeys(p.selected);
      if ("finds" in p) {
        /** @type {Record<string, string>} */
        const finds = {};
        const src = p.finds && typeof p.finds === "object" ? p.finds : {};
        for (const k of facetKeys) if (has(src[k])) finds[k] = String(src[k]);
        out.finds = finds;
      }
      if ("open" in p) out.open = p.open != null && facetKeys.indexOf(String(p.open)) >= 0 ? String(p.open) : null;
      const filterChanged = ("q" in out && out.q !== s.q) || ("facets" in out && JSON.stringify(out.facets) !== JSON.stringify(s.facets));
      if (filterChanged && !("page" in out)) out.page = 1;
      const merged = next(out);
      return JSON.stringify(merged) === JSON.stringify(s) ? s : merged;
    }
    default:
      return s;
  }
}

/**
 * The params of one table in a hash query, with the prefix stripped (all of them for an empty
 * prefix), and the rest.
 * @param {Record<string, string>} params @param {string} prefix
 */
function splitParams(params, prefix) {
  /** @type {Record<string, string>} */
  const own = {};
  /** @type {Record<string, string>} */
  const rest = {};
  for (const k of Object.keys(params || {})) {
    if (k.indexOf(prefix) === 0) own[k.slice(prefix.length)] = params[k];
    else rest[k] = params[k];
  }
  return { own, rest };
}

/**
 * Read the URL part of the table state from a hash query: `<prefix>q`, one `<prefix><facet>`
 * per facet (values comma-joined, as facetsFromParams reads them), `<prefix>sort` ("key", "-key"
 * for descending, "~" for no sort; absent means the default sort) and `<prefix>page` (absent
 * means 1). Unknown sort keys fall back to the default and a bad page reads as 1.
 * @internal
 * @param {Record<string, string>} params hashParams() or parseHash(...).query
 * @param {{ prefix?: string, facetKeys: string[], sortKeys: string[], defaultSort?: TableSort|null }} o
 * @returns {{ q: string, facets: Record<string, string[]>, sort: TableSort, page: number }}
 */
export function tableStateFromParams(params, o) {
  const { own } = splitParams(params || {}, o.prefix || "");
  const { q, selected } = facetsFromParams(own, o.facetKeys);
  const def = cleanSort(o.defaultSort, o.sortKeys);
  const raw = typeof own.sort === "string" ? own.sort : "";
  /** @type {TableSort} */
  let sort = def;
  if (raw === UNSORTED) sort = { key: null, desc: false };
  else if (raw && o.sortKeys.indexOf(raw) >= 0) sort = { key: raw, desc: false };
  else if (raw.charAt(0) === "-" && o.sortKeys.indexOf(raw.slice(1)) >= 0) sort = { key: raw.slice(1), desc: true };
  return { q, facets: cleanFacets(selected, o.facetKeys), sort, page: whole(own.page, 1, MAX_PAGE_SIZE * MAX_PAGE_SIZE) || 1 };
}

/**
 * One facet value as the hash holds it before buildHash encodes the query: only the comma that
 * joins a facet's values and the percent sign that escapes it are escaped, so buildHash encodes
 * everything else once ("Acme Labs" is Acme%20Labs in the address, not Acme%2520Labs) and
 * facetsFromParams still reads it back exactly (it splits on commas and decodes each value).
 * @param {string} v
 */
const hashValue = (v) => v.replace(/%/g, "%25").replace(/,/g, "%2C");

/**
 * The full hash query after a table change: `current` with this table's own params (see
 * tableStateFromParams) replaced and every other param kept as it is, so the app's own URL
 * state survives. The default sort and page 1 are left out. Facet values are comma-joined with
 * only "," and "%" escaped in them (hashValue), so buildHash encodes each value once; links
 * written by facetHashParams, which encodes every value fully, still read the same. Pass the
 * result to setHashParams (or buildHash), which replaces the whole query.
 * @internal
 * @param {Record<string, string>} current
 * @param {{ q: string, facets: Record<string, string[]>, sort: TableSort, page: number }} state
 * @param {{ prefix?: string, facetKeys: string[], defaultSort?: TableSort|null }} o
 * @returns {Record<string, string>}
 */
export function tableHashParams(current, state, o) {
  const prefix = o.prefix || "";
  const { own, rest } = splitParams(current || {}, prefix);
  checkFacetKeys(o.facetKeys);
  /** @type {Record<string, string>} */
  const mine = Object.assign({}, own);
  delete mine.q;
  delete mine.sort;
  delete mine.page;
  for (const k of o.facetKeys || []) delete mine[k];
  if (state.q) mine.q = state.q;
  const facets = state.facets || {};
  for (const k of Object.keys(facets)) {
    const vals = (facets[k] || []).filter((v) => v != null && v !== "").map((v) => hashValue(String(v)));
    if (vals.length) mine[k] = vals.join(",");
  }
  const sort = state.sort || { key: null, desc: false };
  if (!sameSort(sort, o.defaultSort || { key: null, desc: false })) mine.sort = sort.key ? (sort.desc ? "-" : "") + sort.key : UNSORTED;
  if (state.page > 1) mine.page = String(state.page);
  /** @type {Record<string, string>} */
  const out = Object.assign({}, rest);
  for (const k of Object.keys(mine)) out[prefix + k] = mine[k];
  return out;
}

/**
 * @typedef {{ key: string, label: string, value?: (row: any) => unknown, options?: Array<{ value: unknown, label?: string }>, big?: boolean }} TableFacet
 * @typedef {{
 *   id: string, caption: string, noun?: string, columns: TableColumn[], rows: any[] | (() => any[]),
 *   rowKey?: string | ((row: any) => unknown), href?: (row: any) => string|null|undefined,
 *   facets?: TableFacet[], search?: false | { label?: string, placeholder?: string, text?: (row: any) => string },
 *   sort?: TableSort|null, tiebreak?: (a: any, b: any) => number, pageSize?: number, pageSizes?: number[],
 *   selection?: boolean | { label?: (row: any) => string }, rowActions?: (row: any) => any[], rowLabel?: (row: any) => string,
 *   headerMenu?: boolean, density?: "default"|"compact", view?: boolean | { label?: string },
 *   actions?: (table: DataTable, info: { matched: number, total: number, selected: number }) => unknown, loading?: boolean | (() => boolean), error?: unknown, onRetry?: () => void,
 *   emptyTitle?: string, emptyHint?: string,
 *   persist?: { hash?: string|false, storage?: { get: (key: string) => any, set: (key: string, value: unknown) => boolean, remove: (key: string) => boolean }|null, key?: string },
 *   onChange?: (state: TableState) => void, islands?: Record<string, import("@gas-kit/client/islands.js").Island>, win?: any,
 * }} DataTableOptions
 * @typedef {{
 *   parts: () => { toolbar: any, table: any, pagination: any },
 *   view: () => any,
 *   mount: (el: Element) => () => void,
 *   refresh: () => void,
 *   acts: Record<string, (ev: any, el: any) => void>,
 *   state: () => TableState,
 *   setState: (patch: Partial<TableState>, opt?: { persist?: boolean }) => void,
 *   dispatch: (action: TableAction, opt?: { persist?: boolean }) => boolean,
 *   selected: (o?: { matched?: boolean }) => string[],
 *   selectedRows: (o?: { matched?: boolean }) => any[],
 *   clearSelection: () => void,
 *   matchedRows: () => any[],
 *   visibleColumns: () => TableColumn[],
 * }} DataTable
 */

/**
 * Which DOM event carries each act the controller handles: a text field speaks on input, a
 * checkbox or a select on change, a button or menu item on click.
 * @type {Record<string, "click"|"input"|"change">}
 */
const ACT_EVENTS = {
  "dataTableToolbar:search": "input",
  "dataTableToolbar:reset": "click",
  "facetToolbar:set": "change",
  "facetList:find": "input",
  "facetFilter:clear": "click",
  "columnChooser:toggle": "change",
  "columnChooser:reset": "click",
  "dataTable:sort": "click",
  "dataTable:hide": "click",
  "dataTable:select": "change",
  "dataTable:selectAll": "change",
  "dataTable:clear": "click",
  "dataTable:retry": "click",
  "tablePagination:page": "click",
  "tablePagination:size": "change",
};

/**
 * The acts the controller handles, with the DOM event of each. Every other act inside the
 * table (a row action item, an exportMenu pick, an app button in `actions`) is the app's.
 * @internal
 * @returns {Record<string, "click"|"input"|"change">}
 */
export function dataTableControllerActs() {
  return Object.assign({}, ACT_EVENTS);
}

/**
 * Create a data table controller. See the module comment and docs/ARCHITECTURE.md (the
 * createDataTable note) for the options, methods and acts.
 * @internal
 * @param {DataTableOptions} opts
 * @returns {DataTable}
 */
export function createDataTable(opts) {
  const o = /** @type {DataTableOptions} */ (opts || {});
  const id = has(o.id) ? String(o.id) : "data-table";
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new Error("createDataTable: id must start with a letter and use only letters, digits, underscore and hyphen, got " + JSON.stringify(id));
  const noun = has(o.noun) ? String(o.noun) : "rows";
  const caption = has(o.caption) ? String(o.caption) : "Table";

  // The columns as the parts see them: `hideable: false` pins a column (always shown, no Hide
  // item, disabled in the view options); every other keyed, labelled, unpinned column can hide.
  /** @type {TableColumn[]} */
  const columns = (Array.isArray(o.columns) ? o.columns : []).filter((c) => c && typeof c === "object").map((c) => {
    const pinned = c.pinned === true || c.hideable === false;
    const col = Object.assign({}, c, { pinned });
    col.hideable = isHideable(col);
    return col;
  });
  const sortKeys = columns.filter((c) => c.sortable && c.key).map((c) => /** @type {string} */ (c.key));
  const descFirst = columns.filter((c) => c.descFirst && c.key).map((c) => /** @type {string} */ (c.key));

  /** @type {TableFacet[]} */
  const facets = (Array.isArray(o.facets) ? o.facets : []).filter((f) => f && typeof f === "object");
  const facetKeys = checkFacetKeys(facets.map((f) => f.key));
  for (const k of facetKeys) {
    if (RESERVED.indexOf(k) >= 0) throw new Error('createDataTable: a facet cannot use the key "' + k + '" (it is a table param)');
  }
  /** @type {Map<string, (row: any) => unknown>} */
  const valueOf = new Map(facets.map((f) => [f.key, typeof f.value === "function" ? f.value : (/** @type {any} */ r) => (r == null ? null : r[f.key])]));
  // Stable hooks, so the tableModel caches hit across draws.
  /** @param {any} row @param {string} facet */
  const facetValue = (row, facet) => {
    const fn = valueOf.get(facet);
    return fn ? fn(row) : row == null ? null : row[facet];
  };
  const searchOpt = o.search === false ? null : (o.search && typeof o.search === "object" ? o.search : {});
  const text = searchOpt && typeof searchOpt.text === "function" ? searchOpt.text : undefined;

  const rk = o.rowKey == null ? "id" : o.rowKey;
  /** @param {any} r @returns {string} */
  const keyOf = typeof rk === "function" ? (/** @type {any} */ r) => String(rk(r)) : (/** @type {any} */ r) => String(r == null ? "" : r[rk]);
  const selOpt = o.selection ? (typeof o.selection === "object" ? o.selection : {}) : null;
  const viewOpt = o.view === false ? null : (o.view && typeof o.view === "object" ? o.view : {});

  const defaultSort = cleanSort(o.sort, sortKeys);
  // Rows that sort equal keep their input order unless the app breaks the tie (never flipped by
  // the direction). A stable reference, so the tableModel cache hits across draws.
  const tiebreak = typeof o.tiebreak === "function" ? o.tiebreak : undefined;
  const defaultSize = whole(o.pageSize, 1, MAX_PAGE_SIZE) || 10;
  const persist = o.persist && typeof o.persist === "object" ? o.persist : {};
  const prefix = typeof persist.hash === "string" ? persist.hash : null;
  const store = persist.storage && typeof persist.storage.get === "function" ? persist.storage : null;
  const storeKey = has(persist.key) ? String(persist.key) : id;
  const COLS_KEY = storeKey + ".columns";
  const SIZE_KEY = storeKey + ".pageSize";
  const win = o.win || globalThis;
  const hashOpts = { prefix: prefix || "", facetKeys, sortKeys, defaultSort };

  /** The current hash, or "" when there is no location. */
  const hashNow = () => {
    try { return String((win.location && win.location.hash) || ""); } catch (e) { return ""; }
  };
  /** @param {Record<string, string>} query */
  const writeHash = (query) => {
    const cur = parseHash(hashNow());
    const nextHash = buildHash(cur.path, query);
    if (nextHash === buildHash(cur.path, cur.query)) return;
    try {
      if (win.history && typeof win.history.replaceState === "function") win.history.replaceState(null, "", nextHash);
      else win.location.hash = nextHash;
    } catch (e) {
      try { win.location.hash = nextHash; } catch (e2) { /* no location */ }
    }
  };

  /** @type {TableState} */
  let st = {
    q: "", facets: {}, sort: defaultSort, page: 1,
    pageSize: (store && whole(store.get(SIZE_KEY), 1, MAX_PAGE_SIZE)) || defaultSize,
    columns: readColumns(store, COLS_KEY, columns), selected: [], finds: {}, open: null,
  };
  if (prefix !== null) st = Object.assign({}, st, tableStateFromParams(parseHash(hashNow()).query, hashOpts));

  const rowsNow = () => {
    const r = typeof o.rows === "function" ? o.rows() : o.rows;
    return Array.isArray(r) ? r : [];
  };
  /** @param {unknown} v */
  const val = (v) => (typeof v === "function" ? v() : v);
  const compute = () => {
    const all = rowsNow();
    const res = queryTable({ rows: all, columns, sort: st.sort, facets: st.facets, q: st.q, facetValue, text, tiebreak, page: st.page, pageSize: st.pageSize });
    return { all, res, pageKeys: res.rows.map(keyOf) };
  };
  /** @param {any[]} all */
  const matchedOf = (all) => filterRows(all, { facets: st.facets, q: st.q, facetValue, text });
  /** @returns {TableContext} */
  const context = () => ({ columns, facetKeys, sortKeys, descFirst, pageCount: compute().res.pageCount, defaults: { sort: defaultSort, pageSize: defaultSize } });

  /** The options of one facet with scoped counts; values chosen but absent from the data stay listed. @param {TableFacet} f @param {any[]} all */
  const optionsOf = (f, all) => {
    const counts = facetCountsFor(all, { facets: st.facets, q: st.q, facetValue, text }, f.key);
    /** @type {Array<{ value: string, label?: string }>} */
    let base;
    if (Array.isArray(f.options)) base = f.options.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: x.label }));
    else {
      const fn = /** @type {(row: any) => unknown} */ (valueOf.get(f.key));
      base = Array.from(countBy(all, fn).keys()).sort(compareValues).map((v) => ({ value: v }));
    }
    for (const v of st.facets[f.key] || []) if (!base.some((x) => x.value === v)) base.push({ value: v });
    return base.map((x) => ({ value: x.value, label: x.label, count: counts.get(x.value) || 0 }));
  };

  /** @type {DataTable} */
  const api = /** @type {any} */ ({});

  // actions(table, info) may read the table (selected(), matchedRows()); a parts() or view() call
  // from inside it gets no actions slot instead of recursing.
  let inActions = false;
  /** @param {{ matched: number, total: number, selected: number }} info */
  const actionsOf = (info) => {
    inActions = true;
    try { return /** @type {Function} */ (o.actions)(api, info); } finally { inActions = false; }
  };

  const parts = () => {
    const { all, res } = compute();
    const visible = visibleColumns(columns, st.columns);
    const loading = !!val(o.loading);
    const errRaw = val(o.error);
    const error = has(errRaw) ? String(errRaw) : null;
    let selectedInMatched = 0;
    if (selOpt && st.selected.length) {
      const set = new Set(st.selected);
      for (const r of matchedOf(all)) if (set.has(keyOf(r))) selectedInMatched++;
    }
    const active = st.q.trim() !== "" || Object.keys(st.facets).length > 0;
    const toolbar = {
      id,
      search: searchOpt ? { q: st.q, label: has(searchOpt.label) ? searchOpt.label : "Search " + noun, placeholder: has(searchOpt.placeholder) ? searchOpt.placeholder : "Filter " + noun + "..." } : null,
      filters: facets.map((f) => ({ key: f.key, label: f.label, options: optionsOf(f, all), selected: (st.facets[f.key] || []).slice(), find: st.finds[f.key] || "", big: !!f.big, open: st.open === f.key })),
      active,
      view: viewOpt && columns.some((c) => c.hideable) ? { columns, deviations: st.columns, label: has(viewOpt.label) ? viewOpt.label : "View" } : null,
      actions: typeof o.actions === "function" && !inActions ? actionsOf({ matched: res.matched, total: res.total, selected: st.selected.length }) : null,
      matched: res.matched,
      total: res.total,
      noun,
    };
    // A sorted column the viewer hid keeps the sort (the rows do not jump) and its name in the
    // caption's "sorted by" text, though no header shows it.
    const sortedHidden = st.sort.key && !visible.some((c) => c.key === st.sort.key) ? columns.find((c) => c.key === st.sort.key) : null;
    const table = {
      caption, k: id, columns: visible, rows: res.rows, sort: st.sort, total: res.total, matched: res.matched, shown: res.shown,
      sortLabel: sortedHidden && has(sortedHidden.label) ? String(sortedHidden.label) : undefined,
      href: o.href, rowKey: keyOf, noun, loading, error,
      selection: selOpt ? { selected: st.selected.slice(), label: selOpt.label } : null,
      headerMenu: o.headerMenu !== false,
      rowActions: typeof o.rowActions === "function" ? o.rowActions : null,
      rowLabel: o.rowLabel,
      density: o.density,
      emptyTitle: o.emptyTitle,
      emptyHint: o.emptyHint,
    };
    const pagination = {
      id: id + "-pages", page: /** @type {number} */ (res.page), pageCount: /** @type {number} */ (res.pageCount), pageSize: /** @type {number} */ (res.pageSize),
      pageSizes: o.pageSizes, matched: res.matched, selected: selOpt ? selectedInMatched : null, noun,
    };
    return { toolbar, table, pagination };
  };

  // The composition: the toolbar (its own status line left out, because mount keeps one
  // persistent live region) over the table with the pagination bar as its footer.
  const view = () => {
    const p = parts();
    return html`<div class="gk-dataTableView">${
      dataTableToolbar(Object.assign({}, p.toolbar, { matched: null, total: null }))
    }${dataTable(/** @type {any} */ (Object.assign({}, p.table, { footer: tablePagination(p.pagination) })))}</div>`;
  };

  /** @type {Element|null} */
  let region = null;
  /** @type {Element|null} */
  let live = null;
  /** @type {null|(() => void)} */
  let offIslands = null;
  /** @type {any} */
  let speakTimer = null;
  /** What the live region last stood for: the match count and the page, spoken only on a change. */
  let heard = { match: "", page: "" };
  const registry = Object.assign({ facetFilter: facetFilterIsland, columnChooser: columnChooserIsland, dropdownMenu: dropdownMenuIsland, dataTable: dataTableIsland }, o.islands || {});

  /** Write the URL and storage parts that changed between two states. @param {TableState} a @param {TableState} b */
  const persistChange = (a, b) => {
    if (prefix !== null && (a.q !== b.q || a.page !== b.page || !sameSort(a.sort, b.sort) || JSON.stringify(a.facets) !== JSON.stringify(b.facets))) {
      writeHash(tableHashParams(parseHash(hashNow()).query, b, hashOpts));
    }
    if (store && JSON.stringify(a.columns) !== JSON.stringify(b.columns)) writeColumns(store, COLS_KEY, b.columns);
    if (store && a.pageSize !== b.pageSize) {
      if (b.pageSize === defaultSize) store.remove(SIZE_KEY); else store.set(SIZE_KEY, b.pageSize);
    }
  };

  /** The match count ("12 of 60 items match") and the page ("Page 2 of 3") as they stand. */
  const hearNow = () => {
    const { res } = compute();
    const count = Math.max(1, Number(res.pageCount) || 1);
    return {
      match: dataTableToolbarStatus({ matched: res.matched, total: res.total, noun }),
      page: "Page " + fmtCount(Math.min(count, Math.max(1, Number(res.page) || 1))) + " of " + fmtCount(count),
    };
  };
  /**
   * Once changes settle, speak what changed in the persistent live region: the match count when
   * it changed, else the page when that changed (paging, a page size), else nothing. The mount
   * sets the baseline, so a fresh table is silent.
   */
  const announce = () => {
    if (!live) return;
    if (speakTimer) clearTimeout(speakTimer);
    speakTimer = setTimeout(() => {
      speakTimer = null;
      if (!live) return;
      const now = hearNow();
      const say = now.match !== heard.match ? now.match : now.page !== heard.page ? now.page : "";
      heard = now;
      if (say) renderRegion(live, html`${say}`, { keepFocus: false, keepScroll: false });
    }, ANNOUNCE_MS);
  };

  const draw = () => {
    if (!region) return;
    // A page past the end (rows were removed, or a stale link) is clamped, and the URL follows.
    const { res } = compute();
    if (res.page != null && res.page !== st.page) {
      const before = st;
      st = Object.assign({}, st, { page: res.page });
      persistChange(before, st);
    }
    if (offIslands) offIslands();
    offIslands = null;
    renderRegion(region, view(), { keepFocus: true, keepScroll: true });
    offIslands = mountIslands(region, registry);
    announce();
  };

  /**
   * @param {TableAction} action
   * @param {{ persist?: boolean }} [opt] `persist: false` changes the view without writing the hash
   *   or the storage (a later change writes what it changes)
   * @returns {boolean} true when the state changed
   */
  const dispatch = (action, opt) => {
    const nextState = reduceTable(st, action, context());
    if (nextState === st) return false;
    const before = st;
    st = nextState;
    if (!(opt && opt.persist === false)) persistChange(before, st);
    draw();
    if (typeof o.onChange === "function") o.onChange(api.state());
    return true;
  };

  /** @param {string} k */
  const byK = (k) => /** @type {any} */ (region ? region.querySelector('[data-k="' + quote(k) + '"]') : null);
  /** After Reset the button is gone: focus goes to the search box, else the first filter, else the table. */
  const focusAfterReset = () => {
    const t = byK(id + "-search") || (facets.length ? byK(id + "-filter-" + facets[0].key + "-trigger") : null) || byK("table-scroll");
    if (t && typeof t.focus === "function") t.focus();
  };
  /** After Hide column the header is gone: focus goes to the view options (to undo it), else the table. */
  const focusAfterHide = () => {
    if (!region) return;
    const doc = region.ownerDocument;
    const a = doc && doc.activeElement;
    if (a && a !== doc.body && region.contains(a)) return;
    const t = byK(id + "-view-trigger") || byK("table-scroll");
    if (t && typeof t.focus === "function") t.focus();
  };
  /** @param {any} el @param {string} a */
  const attr = (el, a) => (el && typeof el.getAttribute === "function" ? el.getAttribute(a) : null);

  /** @type {Record<string, (ev: any, el: any) => void>} */
  const acts = {
    "dataTableToolbar:search": (_ev, t) => { dispatch({ type: "search", q: t && t.value != null ? t.value : "" }); },
    "dataTableToolbar:reset": () => { dispatch({ type: "reset" }); focusAfterReset(); },
    "dataTable:clear": () => { dispatch({ type: "reset" }); focusAfterReset(); },
    "facetToolbar:set": (_ev, t) => { dispatch({ type: "facet", key: attr(t, "data-facet"), value: attr(t, "data-v") }); },
    "facetList:find": (_ev, t) => { dispatch({ type: "find", key: attr(t, "data-facet"), text: t && t.value != null ? t.value : "" }); },
    "facetFilter:clear": (_ev, t) => { dispatch({ type: "facetClear", key: attr(t, "data-key") }); },
    "columnChooser:toggle": (_ev, t) => { dispatch({ type: "toggleColumn", col: attr(t, "data-col") }); },
    "columnChooser:reset": () => { dispatch({ type: "resetColumns" }); },
    "dataTable:sort": (_ev, t) => { const a = dataTableAct(t); dispatch({ type: "sort", col: a.col, dir: a.dir }); },
    "dataTable:hide": (_ev, t) => { if (dispatch({ type: "hide", col: dataTableAct(t).col })) focusAfterHide(); },
    "dataTable:select": (_ev, t) => { dispatch({ type: "select", key: dataTableAct(t).key }); },
    "dataTable:selectAll": (_ev, t) => { dispatch({ type: "selectAll", on: attr(t, "data-v") !== "off", keys: compute().pageKeys }); },
    "dataTable:retry": () => { if (typeof o.onRetry === "function") o.onRetry(); },
    "tablePagination:page": (_ev, t) => { dispatch({ type: "page", page: attr(t, "data-page") }); },
    "tablePagination:size": (_ev, t) => { dispatch({ type: "pageSize", size: t && t.value != null ? t.value : null }); },
  };

  // Facet filter panels by id, so a beforetoggle event names the facet whose panel opens or closes.
  /** @type {Map<string, string>} */
  const panelFacet = new Map(facets.map((f) => [id + "-filter-" + f.key, f.key]));

  /** @param {Element} el */
  const mount = (el) => {
    if (region) throw new Error("createDataTable: " + id + " is already mounted");
    const held = prefix !== null && win && typeof win === "object" ? (mountedPrefixes.get(win) || new Map()) : null;
    const other = held ? held.get(/** @type {string} */ (prefix)) : null;
    if (other && other.region.isConnected && other.region.ownerDocument === el.ownerDocument) {
      throw new Error("createDataTable: " + id + " uses the hash prefix " + JSON.stringify(prefix) + ", which the mounted table " + other.id + " already uses; give each table on the page its own persist.hash prefix");
    }
    renderRegion(el, html`<div class="gk-dataTableController" data-table="${id}"></div><p class="sr-only" role="status" aria-live="polite" aria-atomic="true" id="${id + "-live"}"></p>`, { keepFocus: false, keepScroll: false });
    const reg = /** @type {Element} */ (el.querySelector('[data-table="' + quote(id) + '"]'));
    region = reg;
    /** This mount's entry in the prefix registry. */
    const mine = { id, region: reg };
    if (held) {
      held.set(/** @type {string} */ (prefix), mine);
      mountedPrefixes.set(win, held);
    }
    live = el.querySelector("#" + id + "-live");
    heard = hearNow();
    /** @param {"click"|"input"|"change"} type */
    const on = (type) => delegate(reg, type, "[data-act]", (ev, t) => {
      const name = String(t.getAttribute("data-act"));
      if (ACT_EVENTS[name] !== type) return;
      if (t.hasAttribute("data-disabled") || t.getAttribute("aria-disabled") === "true") return;
      acts[name](ev, t);
    });
    const offs = [on("click"), on("input"), on("change")];
    // The open panel is tracked on beforetoggle, which fires as the panel opens or closes; toggle
    // comes a task later. A light dismiss by an outside click (Go to next page, a row box, Reset)
    // fires beforetoggle on pointerup and the click's act redraws before toggle, so tracking toggle
    // would draw the panel open again. beforetoggle does not bubble: it is caught on the way down.
    /** @param {any} ev */
    const onBeforeToggle = (ev) => {
      const key = panelFacet.get(String(attr(ev && ev.target, "id")));
      if (key == null) return;
      const open = ev.newState ? ev.newState === "open" : st.open !== key;
      if (open) st = reduceTable(st, { type: "open", key }, context());
      else if (st.open === key) st = reduceTable(st, { type: "open", key: null }, context());
    };
    reg.addEventListener("beforetoggle", onBeforeToggle, true);
    // Back and forward, or a pasted link on the same page, re-read the table's URL state; a
    // hash with another path belongs to another page and is ignored.
    const path = parseHash(hashNow()).path;
    const onHash = () => {
      if (prefix === null || parseHash(hashNow()).path !== path) return;
      const fromUrl = tableStateFromParams(parseHash(hashNow()).query, hashOpts);
      dispatch({ type: "set", patch: fromUrl });
    };
    if (prefix !== null && win && typeof win.addEventListener === "function") win.addEventListener("hashchange", onHash);
    draw();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const off of offs) off();
      reg.removeEventListener("beforetoggle", onBeforeToggle, true);
      if (prefix !== null && win && typeof win.removeEventListener === "function") win.removeEventListener("hashchange", onHash);
      if (held && held.get(/** @type {string} */ (prefix)) === mine) held.delete(/** @type {string} */ (prefix));
      if (offIslands) offIslands();
      offIslands = null;
      if (speakTimer) clearTimeout(speakTimer);
      speakTimer = null;
      region = null;
      live = null;
    };
  };

  /** @param {{ matched?: boolean }} [opt] */
  const selectedKeys = (opt) => {
    if (!(opt && opt.matched)) return st.selected.slice();
    const keys = new Set(matchedOf(rowsNow()).map(keyOf));
    return st.selected.filter((k) => keys.has(k));
  };

  Object.assign(api, {
    parts,
    view,
    mount,
    acts,
    dispatch,
    refresh: () => { draw(); },
    state: () => /** @type {TableState} */ (JSON.parse(JSON.stringify(st))),
    setState: (/** @type {Partial<TableState>} */ patch, /** @type {{ persist?: boolean }|undefined} */ opt) => { dispatch({ type: "set", patch }, opt); },
    selected: selectedKeys,
    selectedRows: (/** @type {{ matched?: boolean }} */ opt) => {
      const set = new Set(st.selected);
      if (!set.size) return [];
      const src = opt && opt.matched ? queryTable({ rows: rowsNow(), columns, sort: st.sort, facets: st.facets, q: st.q, facetValue, text, tiebreak, shown: rowsNow().length }).rows : rowsNow();
      return src.filter((r) => set.has(keyOf(r)));
    },
    clearSelection: () => { dispatch({ type: "clearSelection" }); },
    matchedRows: () => {
      const all = rowsNow();
      return queryTable({ rows: all, columns, sort: st.sort, facets: st.facets, q: st.q, facetValue, text, tiebreak, shown: all.length }).rows;
    },
    visibleColumns: () => visibleColumns(columns, st.columns),
  });
  return api;
}
