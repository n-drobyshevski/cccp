// A checklist of one facet's values with live counts, on the kit facetList: an optional find box, a
// muted row for a value with a zero count and a 'Nothing matches' hint. Used by the right panel
// (facetPanel). Pure: it takes options from domain/query facetOptions. The status dot of a gap or
// 'No tier' row is drawn by CSS (checklist.css), because the kit row has no slot for one.
import { facetList } from "@gas-kit/ui/components/facetList.js";

/**
 * The checklist and, when `big`, its find box. opts: {key, label, options, find, big, scope}
 * where scope ('side') keeps the data-k of two lists apart; options are {value, count, selected}.
 */
export function checklist(opts) {
  return facetList({
    key: opts.key,
    label: opts.label,
    options: opts.options,
    selected: opts.options.filter((o) => o.selected).map((o) => o.value),
    find: opts.find,
    big: !!opts.big,
    scope: opts.scope,
  });
}
