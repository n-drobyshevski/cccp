// Extracted from the author's production Apps Script apps; adapted.
// The side filter panel of a list page: one fieldset per facet, each holding the same facetList
// the facetToolbar pickers show (scope "side", so the two lists never share a data-k), a Hide
// button and Clear all. Its checkboxes and Clear all emit the facetToolbar acts, so the app's
// filter handler serves both. The app owns the open state and the find text per facet; put the
// panel and the results in a .gk-filterLayout for the two-column layout.
import { attrs, html } from "@gas-kit/client/html.js";
import { facetList } from "./facetList.js";
import { checkFacetKeys } from "./facetToolbar.js";

/**
 * @component filterPanel
 * @title Filter Panel
 * @category Data display
 * @summary A side panel of facet checklists with counts, a Hide button and Clear all.
 * @param {{facets: Array<{key: string, label: string, options: Array<{value: string, label?: string, count?: number}>, selected?: string[], big?: boolean}>, finds?: Record<string, string>, open?: boolean, title?: string, id?: string}} p
 * `open` false renders nothing (the app shows its own Filters button). `finds` holds the find box text per facet key; `big` facets get a find box. `id` (default "filter-panel") is the panel's id, which the Hide button controls.
 * @emits filterPanel:hide
 * @emits facetToolbar:set (data-facet, data-v; change event)
 * @emits facetList:find (data-facet; input event, read the value)
 * @emits facetToolbar:clear (data-all, for Clear all)
 * @states default, selected, closed
 * @a11y An aside landmark labelled by the title ("Filters"); the Hide button is labelled "Hide filters" and controls the panel. Each facet is a fieldset whose legend names it, followed by " · n" when n values are selected; the checkboxes carry their own checked state. Facet keys follow the facetToolbar rules. Keys are side-hide, side-clear-all, side-find-<key> and side-<key>:<value>, so one panel fits on a page beside a facetToolbar.
 * @example default: filterPanel({ open: true, facets: [{ key: "env", label: "Environment", options: [{ value: "prod", label: "Production", count: 1204 }, { value: "test", label: "Test", count: 38 }, { value: "dev", label: "Development", count: 0 }] }, { key: "team", label: "Team", big: true, options: [{ value: "acme-ops", label: "Acme Ops", count: 412 }, { value: "acme-web", label: "Acme Web", count: 230 }, { value: "acme-data", label: "Acme Data", count: 96 }] }] })
 * @example selected: filterPanel({ open: true, finds: { team: "web" }, facets: [{ key: "env", label: "Environment", selected: ["prod", "test"], options: [{ value: "prod", label: "Production", count: 1204 }, { value: "test", label: "Test", count: 38 }] }, { key: "team", label: "Team", big: true, selected: ["acme-web"], options: [{ value: "acme-ops", label: "Acme Ops", count: 412 }, { value: "acme-web", label: "Acme Web", count: 230 }] }] })
 * @example closed: filterPanel({ open: false, facets: [{ key: "env", label: "Environment", options: [{ value: "prod", count: 12 }] }] })
 */
export function filterPanel(p) {
  const facets = p.facets || [];
  checkFacetKeys(facets.map((f) => f.key));
  if (p.open === false) return html``;
  const title = p.title == null || p.title === "" ? "Filters" : String(p.title);
  const id = p.id || "filter-panel";
  const finds = p.finds || {};
  let any = false;
  const sets = facets.map((f) => {
    const n = (f.selected || []).length;
    if (n) any = true;
    return html`<fieldset class="gk-filterPanel__facet"><legend class="gk-filterPanel__legend">${f.label}${n ? " · " + n : null}</legend>${
      facetList({ key: f.key, label: f.label, options: f.options || [], selected: f.selected || [], big: !!f.big, find: finds[f.key] == null ? "" : finds[f.key], scope: "side" })
    }</fieldset>`;
  });
  return html`<aside class="gk-filterPanel" ${attrs({ id, "aria-label": title })}><div class="gk-filterPanel__head"><p class="gk-filterPanel__title">${title}</p><button type="button" class="gk-filterPanel__hide gk-btn" data-variant="ghost" data-size="sm" data-act="filterPanel:hide" data-k="side-hide" ${attrs({ "aria-controls": id, "aria-label": "Hide " + title.toLowerCase() })}>Hide</button></div>${sets}${
    any ? html`<div class="gk-filterPanel__foot"><button type="button" class="gk-btn" data-variant="ghost" data-size="sm" data-act="facetToolbar:clear" data-all="1" data-k="side-clear-all">Clear all</button></div>` : null
  }</aside>`;
}
