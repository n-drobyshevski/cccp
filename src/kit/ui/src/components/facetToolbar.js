// Extracted from the author's production Apps Script apps; adapted.
// The filter bar of a list page: a search box, facet pickers (checkbox lists), the active
// filters as removable chips, a result summary and Clear all. An open picker's checklist is
// facetList (scope "opt"), the same list filterPanel shows. The view only renders. The app
// keeps the filter state in the URL hash (facetsFromParams to read, facetHashParams with
// setHashParams and hashParams from the client url helpers to write) and re-renders.
import { attrs, html } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { facetList } from "./facetList.js";

/** @param {string} s */
const enc = (s) => encodeURIComponent(s);
/** @param {string} s */
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

/**
 * Throw when a facet key is not made of letters, digits, underscore and hyphen (it goes into ids,
 * aria-controls and data-k), or collides with the query param ("q"), which would let a facet and
 * the search box overwrite each other in the URL, or with "clear-all", whose data-k it would share.
 * @param {string[]} keys
 * @returns {string[]}
 * @internal
 */
export function checkFacetKeys(keys) {
  for (const k of keys || []) {
    if (k === "q") throw new Error('facetToolbar: a facet cannot use the key "q" (it is the search param)');
    if (k === "clear-all") throw new Error('facetToolbar: a facet cannot use the key "clear-all" (it is the Clear all button)');
    if (typeof k !== "string" || !/^[A-Za-z0-9_-]+$/.test(k)) throw new Error("facetToolbar: a facet key may only use letters, digits, underscore and hyphen, got " + JSON.stringify(k));
  }
  return keys;
}

/**
 * Selected facet values to URL params: one param per facet, values joined with commas (a comma
 * inside a value is percent-encoded). Empty facets are left out. setHashParams REPLACES the whole
 * hash query, so merge this result over hashParams() first (and blank the facet keys that are now
 * empty) or other URL state such as sort or term is dropped.
 * @param {Record<string, string[]>} selected
 * @param {string} [q]
 * @returns {Record<string, string>}
 * @internal
 */
export function facetsToParams(selected, q) {
  /** @type {Record<string, string>} */
  const out = {};
  if (q) out.q = q;
  for (const k of Object.keys(selected || {})) {
    const vals = (selected[k] || []).filter((v) => v !== "");
    if (vals.length) out[k] = vals.map(enc).join(",");
  }
  return out;
}

/**
 * The reverse of facetsToParams, for the given facet keys only (anything else in the hash is
 * ignored).
 * @param {Record<string, string>} params
 * @param {string[]} keys
 * @returns {{ q: string, selected: Record<string, string[]> }}
 * @internal
 */
export function facetsFromParams(params, keys) {
  checkFacetKeys(keys);
  /** @type {Record<string, string[]>} */
  const selected = {};
  const src = params || {};
  for (const k of keys || []) {
    const raw = src[k];
    if (typeof raw === "string" && raw) selected[k] = raw.split(",").filter(Boolean).map(dec);
  }
  return { q: typeof src.q === "string" ? src.q : "", selected };
}

/**
 * The full hash query to write after a filter change: the current params with this toolbar's
 * own keys (q and every facet key) replaced by the new selection, and everything else (sort,
 * term, ...) kept. A facet that is now empty is dropped. Pass the result to setHashParams, which
 * replaces the whole query.
 * @param {Record<string, string>} current hashParams()
 * @param {Record<string, string[]>} selected
 * @param {string} q
 * @param {string[]} keys every facet key of the toolbar, so cleared ones are removed
 * @returns {Record<string, string>}
 * @internal
 */
export function facetHashParams(current, selected, q, keys) {
  checkFacetKeys(keys);
  /** @type {Record<string, string>} */
  const out = Object.assign({}, current || {});
  delete out.q;
  for (const k of keys || []) delete out[k];
  return Object.assign(out, facetsToParams(selected, q));
}

/**
 * Add or remove one value of a facet and return a new selection.
 * @param {Record<string, string[]>} selected
 * @param {string} facet
 * @param {string} value
 * @returns {Record<string, string[]>}
 * @internal
 */
export function toggleFacetValue(selected, facet, value) {
  const cur = (selected && selected[facet]) || [];
  const next = cur.indexOf(value) >= 0 ? cur.filter((v) => v !== value) : cur.concat([value]);
  const out = Object.assign({}, selected);
  if (next.length) out[facet] = next; else delete out[facet];
  return out;
}

/**
 * @component facetToolbar
 * @title Facet Toolbar
 * @category Data display
 * @summary A search box, facet checklists, active-filter chips, a result summary and Clear all.
 * @param {{q?: string, id?: string, searchLabel?: string, placeholder?: string, facets: Array<{key: string, label: string, options: Array<{value: string, label?: string, count?: number}>, selected?: string[]}>, open?: string[], matched?: number, total?: number, noun?: string}} p
 * `open` lists the facet keys whose panel is expanded (the app owns it). `selected` holds the chosen option values.
 * @emits facetToolbar:search (input event; read the value), facetToolbar:toggle (data-facet), facetToolbar:set (data-facet, data-v; change event), facetToolbar:clear (data-facet and data-v for one chip, data-all for Clear all)
 * @states default, open, active, noResults
 * @a11y The search box has a real label and sits in a role=search landmark. Each facet button is aria-expanded and controls its panel, a fieldset with a legend and native checkboxes; counts are visible text, and zero-count options are muted but stay selectable. Facet keys use only letters, digits, underscore and hyphen (and not "q" or "clear-all"); chip and option data-k are chip-<key>:<value> and opt-<key>:<value>, so a hyphen in a key or value never makes two collide. Each chip's remove button is labelled "Remove filter Facet: value". The summary is a status line.
 * @example default: facetToolbar({ facets: [{ key: "env", label: "Environment", options: [{ value: "prod", count: 12 }, { value: "test", count: 4 }] }], matched: 16, total: 16 })
 * @example open: facetToolbar({ facets: [{ key: "env", label: "Environment", options: [{ value: "prod", count: 12 }, { value: "test", count: 0 }] }], open: ["env"], matched: 12, total: 16 })
 * @example active: facetToolbar({ q: "bill", facets: [{ key: "env", label: "Environment", selected: ["prod"], options: [{ value: "prod", count: 2 }] }], matched: 2, total: 16 })
 * @example noResults: facetToolbar({ q: "zzz", facets: [{ key: "env", label: "Environment", options: [{ value: "prod", count: 0 }] }], matched: 0, total: 16 })
 */
export function facetToolbar(p) {
  checkFacetKeys((p.facets || []).map((f) => f.key));
  const id = p.id || "facet-q";
  const noun = p.noun || "rows";
  const facets = p.facets || [];
  const open = p.open || [];
  const label = (/** @type {{value: string, label?: string}} */ o) => (o.label == null ? o.value : o.label);
  const chips = [];
  for (const f of facets) {
    for (const v of f.selected || []) {
      const o = (f.options || []).find((x) => x.value === v);
      const text = f.label + ": " + (o ? label(o) : v);
      chips.push(html`<li class="gk-facetToolbar__chip"><span>${text}</span><button type="button" class="gk-facetToolbar__x gk-btn" data-variant="ghost" data-size="icon" ${attrs({
        "data-act": "facetToolbar:clear", "data-facet": f.key, "data-v": v, "data-k": "chip-" + f.key + ":" + v, "aria-label": "Remove filter " + text,
      })}><span aria-hidden="true">×</span></button></li>`);
    }
  }
  const active = chips.length > 0 || !!(p.q && p.q.trim());
  const panels = facets.map((f) => {
    const isOpen = open.indexOf(f.key) >= 0;
    const n = (f.selected || []).length;
    const panelId = id + "-" + f.key;
    return html`<div class="gk-facetToolbar__facet${n ? " has-value" : ""}"><button type="button" class="gk-facetToolbar__pill gk-btn" data-variant="outline" data-size="sm" ${attrs({
      "data-act": "facetToolbar:toggle", "data-facet": f.key, "data-k": "facet-" + f.key, "aria-expanded": isOpen ? "true" : "false", "aria-controls": isOpen ? panelId : null,
    })}>${f.label}${n ? html` <span class="gk-facetToolbar__n">(${n} selected)</span>` : null}<span aria-hidden="true">${isOpen ? " ▴" : " ▾"}</span></button>${
      isOpen ? html`<fieldset class="gk-facetToolbar__panel" id="${panelId}"><legend class="sr-only">${f.label}</legend>${
        facetList({ key: f.key, label: f.label, options: f.options || [], selected: f.selected || [], scope: "opt" })
      }</fieldset>` : null
    }</div>`;
  });
  const summary = p.matched == null ? null : (p.total != null && p.matched !== p.total ? fmtCount(p.matched) + " of " + fmtCount(p.total) : fmtCount(p.matched)) + " " + noun + (active ? ", filtered" : "");
  return html`<div class="gk-facetToolbar" role="search"><div class="gk-facetToolbar__row"><div class="gk-facetToolbar__search gk-inputGroup"><span class="gk-inputGroup__addon" data-side="start" data-kind="icon">${icon("search", 16)}</span><label class="sr-only" for="${id}">${p.searchLabel || "Search"}</label><input type="search" class="gk-facetToolbar__input gk-input gk-inputGroup__input" autocomplete="off" ${attrs({
    id, value: p.q == null ? "" : p.q, placeholder: p.placeholder || null, "data-act": "facetToolbar:search", "data-k": "facet-q",
  })}></div>${panels}${
    active ? html`<button type="button" class="gk-facetToolbar__clear gk-btn" data-variant="ghost" data-size="sm" data-act="facetToolbar:clear" data-all="1" data-k="facet-clear-all">Clear all</button>` : null
  }</div>${chips.length ? html`<ul class="gk-facetToolbar__chips" aria-label="Active filters">${chips}</ul>` : null}${
    summary ? html`<p class="gk-facetToolbar__summary" role="status">${summary}</p>` : null
  }</div>`;
}
