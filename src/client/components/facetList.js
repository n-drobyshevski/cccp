// A checklist of one facet's values with live counts: an optional find box, a muted row for a
// value with a zero count, a 'Nothing matches' hint and a footer in the popover. Used by the
// pill popovers and by the right panel. Pure: it takes options from domain/query facetOptions.
import { html } from "../lib/html.js";
import { fold } from "../../domain/facets";
import { dot } from "./dots.js";
import { num } from "../lib/format.js";

/** The options whose value contains the find text (accents and case folded). */
export function findOptions(options, find) {
  const q = fold(String(find || "").trim());
  return q ? options.filter((o) => fold(o.value).indexOf(q) >= 0) : options;
}

/**
 * The checklist rows. opts: {key, options, find, scope} where scope ('pop' or 'side') keeps the
 * data-k of the two lists apart. A 'gap' value shows a bad dot with its row.
 */
export function checklist(opts) {
  const list = findOptions(opts.options, opts.find);
  const rows = list.length
    ? list.map((o) => html`<label class="ck${o.count ? "" : " zero"}"><input type="checkbox" data-act="pick" data-facet="${opts.key}" data-v="${o.value}" data-k="${opts.scope}-${opts.key}-${o.value}"${o.selected ? " checked" : ""}>${opts.key === "gap" ? dot("bad") : ""}<span>${o.value}</span><small>${num(o.count)}</small></label>`)
    : html`<span class="hint">Nothing matches</span>`;
  return html`<div class="plist" data-keep-scroll="${opts.scope}-${opts.key}" data-list="${opts.key}">${rows}</div>`;
}

/** The find box, for a facet flagged big. */
export function findBox(opts) {
  return html`<input type="search" class="find" data-find="${opts.key}" data-scope="${opts.scope}" data-k="find-${opts.scope}-${opts.key}" placeholder="Find ${opts.label.toLowerCase()}" value="${opts.find || ""}" aria-label="Find ${opts.label}" autocomplete="off">`;
}

/** The pill popover body: find (big facets), the list, then 'n selected' and Clear. */
export function facetPopover(opts) {
  const n = opts.options.filter((o) => o.selected).length;
  return html`<div class="popin">${opts.big ? findBox({ ...opts, scope: "pop" }) : ""}${checklist({ ...opts, scope: "pop" })}<div class="pfoot"><span>${n} selected</span><button type="button" class="linkbtn" data-act="clear-facet" data-facet="${opts.key}" data-k="pop-clear">Clear</button></div></div>`;
}
