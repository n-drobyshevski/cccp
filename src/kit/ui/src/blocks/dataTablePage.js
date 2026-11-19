// Page-level block: a full data table page (header, search, filters, view options, sort,
// selection, row actions, pagination). The view is pure and serializable; the island makes it live.
// Composed from kit parts (pageHeader, createDataTable and the parts it composes); it adds layout only.
import { html } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { badge } from "../components/badge.js";
import { createDataTable } from "../components/dataTableController.js";
import { pageHeader } from "../components/pageHeader.js";
import { statusDot } from "../components/statusDot.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/** Status words, in workflow order, with the status shape each one draws. */
const STATUS = [
  { word: "Backlog", status: "none" },
  { word: "To do", status: "info" },
  { word: "In progress", status: "warn" },
  { word: "Done", status: "ok" },
  { word: "Canceled", status: "bad" },
];
/** Priority words, lowest first, with the arrow each one draws. */
const PRIORITY = [
  { word: "Low", icon: "arrowDown" },
  { word: "Medium", icon: "chevronRight" },
  { word: "High", icon: "arrowUp" },
];

/** @param {{word: string}[]} list @param {unknown} v */
const rank = (list, v) => list.findIndex((x) => x.word.toLowerCase() === String(v).toLowerCase());

/**
 * The cell renderer of a column kind; a status is a dot plus its word, a priority an arrow plus its word.
 * @param {string} key
 * @param {unknown} kind
 * @returns {(row: any) => unknown}
 */
function cellFor(key, kind) {
  if (kind === "status") {
    return (row) => {
      const v = row[key];
      if (!has(v)) return null;
      const i = rank(STATUS, v);
      return html`<span class="gk-dataTablePage__nowrap">${statusDot({ status: /** @type {any} */ (i >= 0 ? STATUS[i].status : "none"), word: String(v) })}</span>`;
    };
  }
  if (kind === "priority") {
    return (row) => {
      const v = row[key];
      if (!has(v)) return null;
      const i = rank(PRIORITY, v);
      return html`<span class="gk-dataTablePage__priority">${i >= 0 ? html`<span aria-hidden="true">${icon(PRIORITY[i].icon, 14)}</span>` : ""}<span>${String(v)}</span></span>`;
    };
  }
  if (kind === "badge") return (row) => (has(row[key]) ? badge({ text: String(row[key]), variant: "outline" }) : null);
  // Text and dates stay on one line, as in shadcn's table: a narrow frame scrolls the table sideways.
  return (row) => (has(row[key]) ? html`<span class="gk-dataTablePage__nowrap">${String(row[key])}</span>` : null);
}

/**
 * The createDataTable options for the serializable props; the view and the island both call it.
 * No persistence: nothing reaches the URL or storage.
 * @internal
 * @param {any} q
 * @returns {import("../components/dataTableController.js").DataTableOptions}
 */
export function dataTablePageOptions(q) {
  const p = q || {};
  const rowKey = has(p.rowKey) ? String(p.rowKey) : "id";
  const columns = (Array.isArray(p.columns) ? p.columns : []).filter((/** @type {any} */ c) => c && typeof c === "object").map((/** @type {any} */ c) => {
    const key = String(c.key || "");
    /** @type {any} */
    const col = { key, label: String(has(c.label) ? c.label : key), sortable: c.sortable !== false, hideable: c.hideable !== false };
    if (c.kind === "status") col.sortValue = (/** @type {any} */ r) => rank(STATUS, r[key]);
    if (c.kind === "priority") col.sortValue = (/** @type {any} */ r) => rank(PRIORITY, r[key]);
    col.render = cellFor(key, c.kind);
    return col;
  });
  const acts = (Array.isArray(p.rowActions) ? p.rowActions : []).filter((/** @type {any} */ a) => a && has(a.act));
  /** @type {any} */
  const o = {
    id: has(p.id) ? String(p.id) : "data-table-page",
    caption: has(p.caption) ? String(p.caption) : "Table",
    noun: has(p.noun) ? String(p.noun) : "rows",
    columns,
    rows: Array.isArray(p.rows) ? p.rows : [],
    rowKey,
    facets: (Array.isArray(p.facets) ? p.facets : []).filter((/** @type {any} */ f) => f && has(f.key)).map((/** @type {any} */ f) => ({ key: String(f.key), label: String(has(f.label) ? f.label : f.key), options: Array.isArray(f.options) ? f.options : undefined })),
    selection: p.selection === true,
    density: p.density === "compact" ? "compact" : "default",
    persist: {},
  };
  if (Number(p.pageSize) > 0) o.pageSize = Number(p.pageSize);
  if (Array.isArray(p.pageSizes) && p.pageSizes.length) o.pageSizes = p.pageSizes.map(Number).filter((/** @type {number} */ n) => n > 0);
  if (acts.length) o.rowActions = (/** @type {any} */ row) => acts.map((/** @type {any} */ a, /** @type {number} */ i) => ({ text: String(has(a.label) ? a.label : a.act), act: String(a.act), k: "a" + i, v: String(row[rowKey]) }));
  return o;
}

/**
 * @component dataTablePage
 * @title Data Table Page
 * @category Dashboard
 * @summary A full data table page: a header over a working table with search, filter popovers, view options, sortable columns, row selection, row actions and pagination.
 * @param {{title?: string, description?: string, actions?: Array<{label: string, act: string, tip?: string, variant?: string}>, id?: string, caption?: string, noun?: string, rows?: Array<Record<string, any>>, rowKey?: string, columns?: Array<{key: string, label: string, sortable?: boolean, hideable?: boolean, kind?: "text"|"badge"|"status"|"priority"|"date"}>, facets?: Array<{key: string, label: string, options?: Array<{value: string, label?: string}>}>, pageSize?: number, pageSizes?: number[], selection?: boolean, rowActions?: Array<{label: string, act: string}>, density?: "default"|"compact"}} p
 * Every prop is plain data, so the region can travel in `data-props`. `columns` map a `kind` to a cell: `status` is a dot plus the word (Backlog, To do, In progress, Done, Canceled), `priority` an arrow plus the word (Low, Medium, High), `badge` an outline badge, `date` and `text` plain text (dates are `yyyy-MM-dd` strings from the server). A column sorts unless `sortable` is false and hides unless `hideable` is false. `facets` become filter popovers (`options` give the labels, else the values found in the rows). `rowActions` become the per-row menu; each item's act is yours and carries the row key. `rowKey` defaults to id. The first draw is the controller's own view, so the static page and the live one are the same markup; mount the `dataTablePage` island (`dataTablePageIsland`) to make it work. It keeps no URL or storage state.
 * @emits the dataTable acts (dataTable:sort, dataTable:select, dataTable:selectAll, dataTable:hide, dataTable:clear), dataTableToolbar:search, dataTableToolbar:reset, tablePagination:page, tablePagination:size, the pageHeader actions and the row actions
 * @states default, empty, compact
 * @a11y The parts keep their own semantics: a captioned table with aria-sort, a labelled search, filter popovers, a view options menu, native checkboxes and a polite live region for the match count. Status is a shaped dot plus a word and priority an arrow plus a word, never colour alone. Row action triggers are named "Actions for" the row.
 * @example default: dataTablePage({ title: "Findings", description: "Track and triage findings across Acme systems.", id: "tasks", caption: "Findings", noun: "findings", rowKey: "id", pageSize: 10, pageSizes: [10, 20, 30], selection: true, density: "default", columns: [{ key: "id", label: "Finding", hideable: false }, { key: "title", label: "Title" }, { key: "status", label: "Status", kind: "status" }, { key: "priority", label: "Priority", kind: "priority" }, { key: "owner", label: "Owner" }, { key: "due", label: "Due", kind: "date" }], facets: [{ key: "status", label: "Status", options: [{ value: "Backlog" }, { value: "To do" }, { value: "In progress" }, { value: "Done" }, { value: "Canceled" }] }, { key: "priority", label: "Priority", options: [{ value: "Low" }, { value: "Medium" }, { value: "High" }] }], rowActions: [{ label: "Edit", act: "task:edit" }, { label: "Copy id", act: "task:copy" }, { label: "Delete", act: "task:delete" }], rows: Array.from({ length: 30 }, (_, i) => ({ id: "FND-" + (1001 + i), title: ["Outdated TLS configuration", "Admin console exposed", "Service account without an owner", "Backups not verified", "Missing security headers", "Stale access review"][i % 6] + " (" + ["Billing", "Payroll", "Portal"][i % 3] + ")", status: ["Backlog", "To do", "In progress", "Done", "Canceled"][(i * 3) % 5], priority: ["Low", "Medium", "High"][(i * 7) % 3], owner: ["Dana Reyes", "Sam Okafor", "Alex Lee"][i % 3], due: "2026-" + String(11 + (i % 2)).padStart(2, "0") + "-" + String(1 + (i % 28)).padStart(2, "0") })) })
 * @example empty: dataTablePage({ title: "Findings", description: "Nothing has been reported yet.", id: "tasks-empty", caption: "Findings", noun: "findings", columns: [{ key: "id", label: "Finding", hideable: false }, { key: "title", label: "Title" }, { key: "status", label: "Status", kind: "status" }], facets: [{ key: "status", label: "Status" }], selection: true, rows: [] })
 * @example compact: dataTablePage({ title: "Owners", id: "tasks-compact", caption: "Owners", noun: "owners", density: "compact", pageSize: 5, selection: false, columns: [{ key: "id", label: "Id", hideable: false }, { key: "owner", label: "Owner" }, { key: "priority", label: "Priority", kind: "priority" }, { key: "team", label: "Team", kind: "badge" }], rows: [{ id: "OWN-1", owner: "Dana Reyes", priority: "High", team: "Platform" }, { id: "OWN-2", owner: "Sam Okafor", priority: "Medium", team: "Security" }, { id: "OWN-3", owner: "Alex Lee", priority: "Low", team: "Continuity" }] })
 */
export function dataTablePage(p) {
  const q = p || /** @type {any} */ ({});
  const { title, description, actions, ...table } = q;
  const dt = createDataTable(dataTablePageOptions(table));
  return html`<div class="gk-dataTablePage">${pageHeader({ title: has(title) ? String(title) : null, description: has(description) ? String(description) : null, actions: Array.isArray(actions) ? actions : null })}<div class="gk-dataTablePage__region" data-mount="dataTablePage" data-props="${JSON.stringify(table)}">${dt.view()}</div></div>`;
}

/**
 * Makes the data table live: builds the controller from the region's props (no hash, no storage) and
 * mounts it on the region. Returns the controller's teardown. Register it as `dataTablePage`.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const dataTablePageIsland = {
  mount(el, data) {
    return createDataTable(dataTablePageOptions(data)).mount(el);
  },
};
