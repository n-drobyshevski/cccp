// The Inventory's left facet panel (identity G). One section per facet: an uppercase heading with
// Clear while something is selected, the values with a checkbox and a live count, and "+ N more"
// to open the long ones (with a find box on the big facets). It reuses facetList's checklist and
// the domain's facetOptions, so the counts and the filter rules are the ones every page uses.
// Pure: the page owns the selection, the find text and which sections are open.
import { html } from "../lib/html.js";
import { FACET_BY_KEY } from "../../domain/facets";
import { facetOptions } from "../../domain/query";
import { checklist, findBox } from "./facetList.js";

/** The facets the panel lists, in order. */
export const PANEL_FACETS = ["tier", "lc", "dom", "so", "gap", "sd", "ty", "h"];
/** Values shown before "+ N more". */
export const TOP_N = 5;

/** Values by count, most first (the order's own sequence breaks ties); fixed orders are kept. */
export function ranked(options, key) {
  if (FACET_BY_KEY[key].order) return options;
  return options.map((o, i) => ({ o, i })).sort((a, b) => b.o.count - a.o.count || a.i - b.i).map((x) => x.o);
}

/** What a section shows: every value when open, else the top N plus any selected value. */
export function visibleOptions(options, key, open) {
  const list = ranked(options, key);
  const shown = open ? list : list.filter((o, i) => i < TOP_N || o.selected);
  return { shown, hidden: list.length - shown.length, total: list.length };
}

function section(s, rows, key, st) {
  const def = FACET_BY_KEY[key];
  const options = facetOptions(rows, { q: s.q, f: s.f }, key);
  if (!options.length) return "";
  const open = st.open.has(key);
  const n = (s.f[key] || []).length;
  const v = visibleOptions(options, key, open);
  const find = (st.finds && st.finds[key]) || "";
  const toggle = v.total > TOP_N
    ? html`<button type="button" class="tlink" data-act="more-facet" data-facet="${key}" data-k="fmore-${key}" aria-expanded="${open ? "true" : "false"}">${open ? "Show fewer" : "+ " + v.hidden + " more"}</button>`
    : "";
  return html`<section class="fg" data-facet="${key}" aria-labelledby="fh-${key}"><h4 class="fh"><span id="fh-${key}">${def.label}</span><span class="fact">${n ? html`<button type="button" class="tlink" data-act="clear-facet" data-facet="${key}" data-k="fclear-${key}" aria-label="Clear ${def.label}">Clear</button>` : ""}${toggle}</span></h4>${open && def.big ? findBox({ key, label: def.label, scope: "side", find }) : ""}${checklist({ key, options: v.shown, find: open ? find : "", scope: "side" })}</section>`;
}

/** The panel body. st = {open: Set of facet keys, finds: {key: text}}. */
export function facetPanelView(s, rows, st) {
  return html`${PANEL_FACETS.map((k) => section(s, rows, k, st))}`;
}

/** The facet map with one value switched on or off. Empty lists are dropped. */
export function toggled(f, key, value, on) {
  const cur = f[key] || [];
  const next = on ? (cur.indexOf(value) >= 0 ? cur : cur.concat([value])) : cur.filter((v) => v !== value);
  return withFacet(f, key, next);
}

export function withFacet(f, key, values) {
  const out = { ...f };
  if (values.length) out[key] = values;
  else delete out[key];
  return out;
}
