// The Overview page model: four headline figures, one status bar per pillar and the domains with
// the most gaps, over the whole visible register. Pure. Every figure carries `target`, the
// list filters that reproduce its number through query.ts: the page navigates to the List with
// exactly those params, and the List then counts the same applications.

import type { FacetKey, Pillar, Status } from "./types";
import { PILLARS } from "./types";
import type { Row } from "./facets";
import { GAP_ORDER, NONE_ASSIGNED, PILLAR_LABEL, TIER_ORDER } from "./facets";
import { filterRows } from "./query";

export type Target = Partial<Record<FacetKey, string[]>>;

export const EOL_LABELS: readonly string[] = ["End of life", "End of support"];
export const TOP_DOMAINS = 8;
/** Stacked bar order: worst first. */
export const STATUS_STACK: readonly Status[] = ["bad", "warn", "none", "ok"];

export interface Kpi {
  id: "gap" | "t1gap" | "noso" | "eol";
  label: string;
  tone: "bad" | "warn";
  value: number;
  /** What the value is a share of. */
  denominator: number;
  /** What the denominator counts, e.g. 'applications' or 'Tier 1 applications'. */
  of: string;
  /** Whole percent of the denominator. */
  pct: number;
  /** The list filters that reproduce `value`. */
  target: Target;
  /** The list filters that reproduce `denominator`. */
  denominatorTarget: Target;
}

export interface PillarBar {
  pillar: Pillar;
  label: string;
  total: number;
  /** Counts by status; they sum to `total`. */
  counts: Record<Status, number>;
  /** The list filters that reproduce counts.bad. */
  target: Target;
}

export interface DomainRow {
  name: string;
  apps: number;
  gaps: number;
  /** Mean completeness, whole percent. */
  completeness: number;
  /** Reproduces `apps`. */
  target: Target;
  /** Reproduces `gaps`. */
  gapTarget: Target;
}

export interface Overview {
  total: number;
  kpis: Kpi[];
  pillars: PillarBar[];
  domains: DomainRow[];
}

/** The two panel titles of the Overview, shared with its loading skeleton. */
export const OVERVIEW_TITLES = { pillars: "Status by pillar", domains: "Domains with the most gaps" } as const;

const pctOf = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);
const anyGap = (): string[] => GAP_ORDER.slice();

export function overviewModel(rows: readonly Row[]): Overview {
  const total = rows.length;
  const n = (f: Target): number => filterRows(rows, { q: "", f }).length;

  const mk = (id: Kpi["id"], label: string, tone: Kpi["tone"], target: Target, denominatorTarget: Target, of: string): Kpi => {
    const value = n(target);
    const denominator = n(denominatorTarget);
    return { id, label, tone, value, denominator, of, pct: pctOf(value, denominator), target, denominatorTarget };
  };
  const kpis: Kpi[] = [
    mk("gap", "Applications with a gap", "bad", { gap: anyGap() }, {}, "applications"),
    mk("t1gap", "Tier 1 with a gap", "bad", { tier: [TIER_ORDER[0]!], gap: anyGap() }, { tier: [TIER_ORDER[0]!] }, "Tier 1 applications"),
    mk("noso", "No security officer", "warn", { so: [NONE_ASSIGNED] }, {}, "applications"),
    mk("eol", "Past end of life", "warn", { lc: EOL_LABELS.slice() }, {}, "applications"),
  ];

  const pillars: PillarBar[] = PILLARS.map((p) => {
    const counts: Record<Status, number> = { bad: 0, warn: 0, none: 0, ok: 0 };
    for (const r of rows) counts[r.status[p].status]++;
    return { pillar: p, label: PILLAR_LABEL[p], total, counts, target: { gap: [PILLAR_LABEL[p]] } };
  });

  const byDomain = new Map<string, Row[]>();
  for (const r of rows) {
    const d = r.app.domain && r.app.domain.trim() ? r.app.domain.trim() : "NO DOMAIN";
    const list = byDomain.get(d);
    if (list) list.push(r); else byDomain.set(d, [r]);
  }
  const domains: DomainRow[] = [...byDomain.entries()].map(([name, rs]) => {
    const target: Target = { dom: [name] };
    const gapTarget: Target = { dom: [name], gap: anyGap() };
    return {
      name,
      apps: n(target),
      gaps: n(gapTarget),
      completeness: Math.round(rs.reduce((s, r) => s + r.pct, 0) / rs.length),
      target,
      gapTarget,
    };
  });
  domains.sort((a, b) => b.gaps - a.gaps || b.apps - a.apps || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { total, kpis, pillars, domains: domains.slice(0, TOP_DOMAINS) };
}
