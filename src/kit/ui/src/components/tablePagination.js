// The pagination bar of a data table (shadcn Data Table pagination): the selected-row count on the
// left; rows per page, "Page x of y" and first, previous, next, last buttons on the right. Pages
// are 1-based. Acts: tablePagination:page (click; data-page is the target page) and
// tablePagination:size (change on the select; read the new size from the element's value, with
// delegate(root, "change", '[data-act="tablePagination:size"]', fn)). The app owns the state.
import { attrs, html } from "@gas-kit/client/html.js";
import { fmtCount as fmt } from "@gas-kit/client/format.js";
import { icon } from "@gas-kit/client/icons.js";

const DEFAULT_SIZES = [10, 20, 25, 30, 40, 50];

/** A whole number at least `min`, else `min`. @param {unknown} v @param {number} min */
function whole(v, min) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : min;
}

/**
 * The sizes to offer: positive whole numbers, unique, ascending, always including the current one.
 * @internal
 * @param {unknown} sizes
 * @param {number} current
 * @returns {number[]}
 */
export function pageSizeOptions(sizes, current) {
  const list = Array.isArray(sizes) && sizes.length ? sizes : DEFAULT_SIZES;
  const set = new Set([current]);
  for (const s of list) {
    const n = Math.round(Number(s));
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * @component tablePagination
 * @title Table Pagination
 * @category Navigation
 * @summary The data table pagination bar: selected count, rows per page, Page x of y and first, previous, next, last.
 * @param {{page: number, pageCount: number, pageSize: number, pageSizes?: number[], matched: number, selected?: number|null, noun?: string, id?: string, k?: string}} p
 * @emits tablePagination:page (click; data-page is the target page), tablePagination:size (change on the select; read the value from the element)
 * @states default, firstPage, lastPage, singlePage, withSelection, customSizes
 * @a11y A div labelled Pagination (a group, so it does not add a second navigation landmark beside a pager). The selected count is a role=status element, shown only when `selected` is a number; renderRegion replaces it on a re-render, so keep the bar outside the re-rendered region if announcements matter. The select has a visible label "Rows per page" (for=id). The four icon buttons have sr-only names (Go to first page, Go to previous page, Go to next page, Go to last page). An unavailable button keeps focus but has aria-disabled=true and no data-act, so a click does nothing and focus is never lost to the body (as in pager). Below 30rem of bar width the first and last buttons are hidden with display none (so they leave the tab order too); on wider bars every button is reachable by keyboard. Inputs are clamped: page below 1 or above pageCount, pageCount below 1, a pageSize missing from pageSizes is added. `noun` is the plural (default rows) and loses a trailing s when matched is 1.
 * @example default: tablePagination({ page: 3, pageCount: 12, pageSize: 10, matched: 118, id: "tp-a" })
 * @example firstPage: tablePagination({ page: 1, pageCount: 12, pageSize: 10, matched: 118, id: "tp-b" })
 * @example lastPage: tablePagination({ page: 12, pageCount: 12, pageSize: 10, matched: 118, id: "tp-c" })
 * @example singlePage: tablePagination({ page: 1, pageCount: 1, pageSize: 10, matched: 7, id: "tp-d" })
 * @example withSelection: tablePagination({ page: 2, pageCount: 5, pageSize: 25, matched: 118, selected: 3, noun: "applications", id: "tp-e" })
 * @example customSizes: tablePagination({ page: 1, pageCount: 3, pageSize: 100, pageSizes: [25, 50, 100], matched: 240, id: "tp-f" })
 */
export function tablePagination(p) {
  const size = whole(p.pageSize, 1);
  const count = whole(p.pageCount, 1);
  const page = Math.min(count, whole(p.page, 1));
  const matched = whole(p.matched, 0);
  const base = p.id == null || p.id === "" ? "tablePagination" : String(p.id);
  const kb = p.k == null || p.k === "" ? base : String(p.k);
  const sel = typeof p.selected === "number" && Number.isFinite(p.selected) ? Math.max(0, Math.round(p.selected)) : null;
  const plural = p.noun || "rows";
  const noun = matched === 1 && /s$/.test(plural) ? plural.slice(0, -1) : plural;
  const selId = base + "-size";

  const step = (/** @type {string} */ key, /** @type {number} */ to, /** @type {string} */ label, /** @type {boolean} */ off, /** @type {unknown} */ glyph, /** @type {string} */ cls) => html`<button ${attrs({
    type: "button", class: "gk-tablePagination__btn gk-btn" + cls + (off ? " is-disabled" : ""), "data-variant": "outline", "data-size": "icon",
    "data-act": off ? null : "tablePagination:page", "data-page": off ? null : to, "data-k": kb + "-" + key, "aria-disabled": off ? "true" : null,
  })}>${glyph}<span class="sr-only">${label}</span></button>`;
  const ic = (/** @type {string} */ name) => html`<span class="gk-tablePagination__ic">${icon(name)}</span>`;

  return html`<div class="gk-tablePagination" role="group" aria-label="Pagination">${
    sel === null ? null : html`<span class="gk-tablePagination__selected" role="status">${fmt(sel)} of ${fmt(matched)} ${noun} selected.</span>`
  }<div class="gk-tablePagination__controls"><span class="gk-tablePagination__size"><label class="gk-tablePagination__label" ${attrs({ for: selId })}>Rows per page</label><select ${attrs({
    id: selId, class: "gk-tablePagination__select gk-input", "data-act": "tablePagination:size", "data-k": kb + "-size",
  })}>${pageSizeOptions(p.pageSizes, size).map((n) => html`<option ${attrs({ value: n, selected: n === size })}>${n}</option>`)}</select></span><span class="gk-tablePagination__page">Page ${fmt(page)} of ${fmt(count)}</span><span class="gk-tablePagination__steps">${
    step("first", 1, "Go to first page", page <= 1, ic("chevronsLeft"), " is-edge")}${
    step("prev", page - 1, "Go to previous page", page <= 1, ic("chevronLeft"), "")}${
    step("next", page + 1, "Go to next page", page >= count, ic("chevronRight"), "")}${
    step("last", count, "Go to last page", page >= count, ic("chevronsRight"), " is-edge")
  }</span></div></div>`;
}
