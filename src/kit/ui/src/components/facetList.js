// Extracted from the author's production Apps Script apps; adapted.
// The checklist of one facet's values with live counts: an optional find box (for a facet with
// many values), native checkboxes with a visible count, muted zero-count rows that stay
// selectable, and a hint when the find text matches nothing. facetToolbar's open panel and
// filterPanel both render it, and its checkboxes emit facetToolbar:set, so one app handler
// serves every list. The caller wraps it in a fieldset with a legend.
import { attrs, html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { fold } from "./tableModel.js";

/**
 * @typedef {{value: string, label?: string, count?: number}} FacetOption
 */

/** @param {FacetOption} o */
const optLabel = (o) => (o.label == null ? o.value : o.label);

/**
 * The options whose label or value contains the find text, with accents and case folded
 * ("zur" finds "Zürich"). A blank find returns the options unchanged.
 * @param {FacetOption[]} options
 * @param {string} [find]
 * @returns {FacetOption[]}
 * @internal
 */
export function findOptions(options, find) {
  const list = options || [];
  const q = fold(String(find == null ? "" : find).trim());
  if (!q) return list;
  return list.filter((o) => fold(optLabel(o)).indexOf(q) >= 0 || fold(o.value).indexOf(q) >= 0);
}

/**
 * @component facetList
 * @title Facet List
 * @category Data display
 * @summary The checklist of one facet's values with counts, and a find box for a long list.
 * @param {{key: string, label: string, options: Array<{value: string, label?: string, count?: number}>, selected?: string[], find?: string, big?: boolean, scope?: string}} p
 * `find` is the find box text (the app owns it); `big` shows the find box. `scope` (default "opt") keeps the data-k of two lists of the same facet apart.
 * @emits facetToolbar:set (data-facet, data-v; change event)
 * @emits facetList:find (data-facet; input event, read the value)
 * @states default, big, noMatch, empty
 * @a11y Native checkboxes with the value as visible label text and the count as visible text; zero-count rows are muted but stay selectable, and their count still reads 0. The find box is a search input labelled "Find <label>". The caller wraps the list in a fieldset whose legend names the facet. Option data-k are <scope>-<key>:<value> and the find box is <scope>-find-<key>; the list keeps its scroll across renders (data-keep-scroll <scope>-<key>).
 * @example default: facetList({ key: "env", label: "Environment", options: [{ value: "prod", label: "Production", count: 1204 }, { value: "test", label: "Test", count: 38 }, { value: "dev", label: "Development", count: 0 }], selected: ["prod"] })
 * @example big: facetList({ key: "city", label: "City", big: true, find: "zur", options: [{ value: "zurich", label: "Zürich", count: 12 }, { value: "zug", label: "Zug", count: 3 }, { value: "bern", label: "Bern", count: 7 }] })
 * @example noMatch: facetList({ key: "team", label: "Team", big: true, find: "qqq", options: [{ value: "acme-ops", label: "Acme Ops", count: 4 }, { value: "acme-web", label: "Acme Web", count: 9 }] })
 * @example empty: facetList({ key: "team", label: "Team", options: [] })
 */
export function facetList(p) {
  const scope = p.scope || "opt";
  const options = p.options || [];
  const selected = p.selected || [];
  const label = p.label == null ? "" : String(p.label);
  const list = findOptions(options, p.find);
  const findBox = p.big ? html`<input type="search" class="gk-facetList__find gk-input" autocomplete="off" ${attrs({
    value: p.find == null ? "" : p.find,
    placeholder: "Find " + label.toLowerCase(),
    "aria-label": "Find " + label,
    "data-act": "facetList:find",
    "data-facet": p.key,
    "data-k": scope + "-find-" + p.key,
  })}>` : null;
  const rows = options.length === 0
    ? html`<p class="gk-facetList__hint">Nothing to choose</p>`
    : list.length === 0
      ? html`<p class="gk-facetList__hint">Nothing matches</p>`
      : list.map((o) => html`<label class="gk-facetList__opt${o.count === 0 ? " is-zero" : ""}"><input type="checkbox" class="gk-facetList__box" ${attrs({
        "data-act": "facetToolbar:set", "data-facet": p.key, "data-v": o.value, "data-k": scope + "-" + p.key + ":" + o.value, checked: selected.indexOf(o.value) >= 0,
      })}><span class="gk-facetList__label">${optLabel(o)}</span>${o.count == null ? null : html`<span class="gk-facetList__count">${fmtCount(o.count)}</span>`}</label>`);
  return html`<div class="gk-facetList">${findBox}<div class="gk-facetList__list" data-keep-scroll="${scope + "-" + p.key}">${rows}</div></div>`;
}
