// The Heatmap page model: the visible, filtered rows grouped by domain, largest first, with an
// exact per-pillar count of every status in each group. Pure. `bad` is the number the page
// shows in red beside each bar, so it is always the same figure as counts.bad.

import type { Pillar, Status } from "./types";
import { PILLARS } from "./types";
import type { Row } from "./facets";
import { facetValuesOf } from "./facets";

/** The two fixed column heads that lead the heatmap, shared with its loading skeleton. */
export const HEATMAP_LEAD_HEADS = ["Domain / application", "Tier"] as const;

/** At this many applications or fewer every group starts open. */
export const OPEN_ALL_MAX = 40;
/** Stacked bar order, left to right: OK, Attention, Gap, then No data (identity G). */
export const HEAT_STACK: readonly Status[] = ["ok", "warn", "bad", "none"];

export interface HeatGroup {
  name: string;
  apps: number;
  /** Per pillar, the number of applications at each status; each sums to `apps`. */
  counts: Record<Pillar, Record<Status, number>>;
  rows: Row[];
}

export interface Heatmap {
  total: number;
  groups: HeatGroup[];
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function heatmapModel(rows: readonly Row[]): Heatmap {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const name = facetValuesOf(r, "dom")[0]!;
    const list = by.get(name);
    if (list) list.push(r); else by.set(name, [r]);
  }
  const groups: HeatGroup[] = [...by.entries()].map(([name, rs]) => {
    const counts = {} as Record<Pillar, Record<Status, number>>;
    for (const p of PILLARS) {
      const c: Record<Status, number> = { bad: 0, warn: 0, none: 0, ok: 0 };
      for (const r of rs) c[r.status[p].status]++;
      counts[p] = c;
    }
    return { name, apps: rs.length, counts, rows: rs };
  });
  groups.sort((a, b) => b.apps - a.apps || byName(a.name, b.name));
  return { total: rows.length, groups };
}

/** The groups open on first sight: every one for a small register, else the largest. */
export const isOpenAll = (m: Heatmap): boolean => m.total <= OPEN_ALL_MAX || m.groups.length === 1;

export function defaultOpen(m: Heatmap): string[] {
  if (!m.groups.length) return [];
  if (isOpenAll(m)) return m.groups.map((g) => g.name);
  return [m.groups[0]!.name];
}
