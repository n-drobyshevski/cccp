// Filter, facet-count and sort semantics over register rows. OR within a facet, AND across
// facets, AND across search terms. A facet's own counts ignore that facet's selection so the
// reader can see what adding a value would bring.

import type { FacetKey, ViewState } from "./types";
import { sortRows as sortWith } from "../vendor/gas_shared/ui/tableModel";
import type { Row } from "./facets";
import { FACETS, FACET_KEYS, facetValues, facetValuesOf, fold } from "./facets";
import { COLUMN_BY_KEY, DEFAULT_SORT } from "./columns";

export type Selection = Partial<Record<FacetKey, string[]>>;
export interface Filter { q: string; f: Selection }

/** Every whitespace-separated term must appear in the folded search text. */
export function matchesText(r: Row, q: string): boolean {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  for (const t of terms) if (!r.text.includes(t)) return false;
  return true;
}

export function matchesFacet(r: Row, key: FacetKey, selected: readonly string[] | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  return facetValuesOf(r, key).some((v) => selected.includes(v));
}

/** Does the row pass search and every facet, except `skip`? */
export function matchRow(r: Row, filter: Filter, skip?: FacetKey): boolean {
  if (!matchesText(r, filter.q)) return false;
  for (const k of FACET_KEYS) if (k !== skip && !matchesFacet(r, k, filter.f[k])) return false;
  return true;
}

export function filterRows(rows: readonly Row[], filter: Filter): Row[] {
  return rows.filter((r) => matchRow(r, filter));
}

/** value -> number of rows that pass everything except this facet's own selection. */
export function facetCounts(rows: readonly Row[], filter: Filter, key: FacetKey): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!matchRow(r, filter, key)) continue;
    for (const v of facetValuesOf(r, key)) out.set(v, (out.get(v) || 0) + 1);
  }
  return out;
}

export interface FacetOption { value: string; count: number; selected: boolean }

/** Every value of the register for a facet in display order with its live count (zero rows included). */
export function facetOptions(rows: readonly Row[], filter: Filter, key: FacetKey): FacetOption[] {
  const counts = facetCounts(rows, filter, key);
  const sel = filter.f[key] || [];
  return facetValues(rows, key).map((value) => ({ value, count: counts.get(value) || 0, selected: sel.includes(value) }));
}

/** How many facet values are selected in total. */
export function activeFilterCount(f: Selection): number {
  return FACETS.reduce((n, d) => n + (f[d.key] ? f[d.key]!.length : 0), 0);
}

/** Sort by a column key with the vendored comparison: unknowns last, name tie-break. */
export function sortRows(rows: readonly Row[], key: string, desc: boolean): Row[] {
  const col = COLUMN_BY_KEY[key] || COLUMN_BY_KEY[DEFAULT_SORT]!;
  return sortWith(rows as Row[], {
    value: (r: Row) => col.sort(r),
    descending: desc,
    tiebreak: (r: Row) => r.app.name + "\u0000" + r.app.id,
  }) as Row[];
}

/** The filtered and sorted rows for a view state. */
export function runQuery(rows: readonly Row[], s: Pick<ViewState, "q" | "f" | "sort" | "desc">): Row[] {
  return sortRows(filterRows(rows, s), s.sort || DEFAULT_SORT, s.desc);
}
