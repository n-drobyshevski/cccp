// Filter, facet-count and sort semantics over register rows. OR within a facet, AND across
// facets, AND across search terms. A facet's own counts ignore that facet's selection so the
// reader can see what adding a value would bring.

import type { FacetKey, Pillar, ViewState } from "./types";
import { PILLARS } from "./types";
import { sortRows as sortWith } from "@gas-kit/ui/components/tableModel.js";
import type { Row } from "./facets";
import { FACETS, FACET_KEYS, PILLAR_LABEL, facetValues, facetValuesOf, fold } from "./facets";
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

/**
 * Text sorts as lower-case text and unknowns (null) sort last in both directions, ties by name then id.
 * The kit's comparison reads a string that looks like a plain number as a number ("10" after "9"); the
 * list has always ordered text as text, so a string value gets a constant prefix, which keeps the
 * text order and keeps it from reading as a number. A number value (tier, status key, completeness)
 * stays a number.
 */
const textOrder = (v: string | number | null): string | number | null => (typeof v === "string" ? "s" + v : v);

/** The tie-break is never flipped by the direction: lower-case text of name and id. */
const byNameThenId = (a: Row, b: Row): number => {
  const x = (a.app.name + "\u0000" + a.app.id).toLowerCase();
  const y = (b.app.name + "\u0000" + b.app.id).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Sort by a column key with the kit's stable sort: unknowns last, name tie-break. */
export function sortRows(rows: readonly Row[], key: string, desc: boolean): Row[] {
  const col = COLUMN_BY_KEY[key] || COLUMN_BY_KEY[DEFAULT_SORT]!;
  return sortWith(rows as Row[], { value: (r: Row) => textOrder(col.sort(r)), descending: desc, tiebreak: byNameThenId }) as Row[];
}

/** The filtered and sorted rows for a view state. */
export function runQuery(rows: readonly Row[], s: Pick<ViewState, "q" | "f" | "sort" | "desc">): Row[] {
  return sortRows(filterRows(rows, s), s.sort || DEFAULT_SORT, s.desc);
}

/** Pillar tabs over the Inventory: 'all' or one pillar. A tab is the "Gap in" facet with one value. */
export type PillarTab = "all" | Pillar;

/** Which tab a selection is on: one pillar under "Gap in" is that tab, nothing selected is All,
 *  and several pillars (picked in the panel) are no single tab, so null. */
export function pillarTabOf(f: Selection): PillarTab | null {
  const g = f.gap || [];
  if (!g.length) return "all";
  if (g.length > 1) return null;
  return PILLARS.find((p) => PILLAR_LABEL[p] === g[0]) || null;
}

/** The selection with the tab applied: a pillar sets "Gap in" to it, All clears it. */
export function withPillarTab(f: Selection, tab: PillarTab): Selection {
  const out: Selection = { ...f };
  if (tab === "all") delete out.gap;
  else out.gap = [PILLAR_LABEL[tab]];
  return out;
}

export interface PillarCounts { all: number; gaps: Record<Pillar, number> }

/** The counts the tabs show: rows that pass search and every facet except "Gap in" (so the
 *  tabs stay comparable while one is selected), and how many of those have a gap per pillar. */
export function pillarCounts(rows: readonly Row[], filter: Filter): PillarCounts {
  const gaps: Record<Pillar, number> = { cyber: 0, compliance: 0, continuity: 0, platform: 0 };
  let all = 0;
  for (const r of rows) {
    if (!matchRow(r, filter, "gap")) continue;
    all++;
    for (const p of PILLARS) if (r.status[p].status === "bad") gaps[p]++;
  }
  return { all, gaps };
}
