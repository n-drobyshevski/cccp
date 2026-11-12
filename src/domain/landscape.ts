// The Landscape page model: the visible, filtered rows as domain boxes, each split into
// subdomain groups of named tiles, coloured by one metric. Pure. A blank subdomain groups as
// 'Other'. Domains and groups are ordered by size (largest first) then name; tiles by name.

import type { Pillar } from "./types";
import { PILLARS } from "./types";
import type { Row } from "./facets";
import { PILLAR_LABEL, STATUS_WORD, facetValuesOf } from "./facets";
import { qualityLevel } from "./quality";

export const OTHER_GROUP = "Other";

/** What a tile can be coloured by, in the order of the switch. */
export interface LandscapeMetric { key: string; label: string }
export const LANDSCAPE_METRICS: readonly LandscapeMetric[] = [
  { key: "worst", label: "Worst status" },
  { key: "c0", label: "Cyber" },
  { key: "c1", label: "Compliance" },
  { key: "c2", label: "Continuity" },
  { key: "c3", label: "Platform" },
  { key: "tier", label: "Tier" },
  { key: "q", label: "Completeness" },
];

/** A tone is a class on the tile: ok, warn, bad, t1..t4, or none (unknown, drawn hatched). */
export type Tone = "ok" | "warn" | "bad" | "t1" | "t2" | "t3" | "t4" | "none";

export interface Tile { id: string; name: string; tone: Tone; tip: string }
export interface LandscapeGroup { name: string; apps: number; tiles: Tile[] }
export interface LandscapeDomain { name: string; apps: number; groups: LandscapeGroup[] }
export interface Landscape { total: number; metric: string; domains: LandscapeDomain[] }
export interface LegendItem { tone: Tone; label: string }

export function metricOf(key: string): LandscapeMetric {
  return LANDSCAPE_METRICS.find((m) => m.key === key) || LANDSCAPE_METRICS[0]!;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const cmpName = (a: string, b: string): number => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : byName(a, b);
};

/** The tone and the tip fragment for one row under one metric. */
export function toneOf(r: Row, metric: string): { tone: Tone; value: string } {
  if (metric === "tier") {
    const t = r.app.tier;
    return t != null && t >= 1 && t <= 4 ? { tone: ("t" + t) as Tone, value: "T" + t } : { tone: "none", value: "none" };
  }
  if (metric === "q") return { tone: qualityLevel(r.pct), value: r.pct + "%" };
  const pillar: Pillar | null = metric.length === 2 && metric.charAt(0) === "c" ? PILLARS[Number(metric.charAt(1))] || null : null;
  const s = pillar ? r.status[pillar].status : r.status.worst;
  return { tone: s, value: STATUS_WORD[s] };
}

/** The legend entries that follow the metric. */
export function legendFor(metric: string): LegendItem[] {
  if (metric === "tier") return [{ tone: "t1", label: "T1" }, { tone: "t2", label: "T2" }, { tone: "t3", label: "T3" }, { tone: "t4", label: "T4" }, { tone: "none", label: "No tier" }];
  if (metric === "q") return [{ tone: "ok", label: "80% or more" }, { tone: "warn", label: "50–79%" }, { tone: "bad", label: "Under 50%" }];
  return [{ tone: "ok", label: STATUS_WORD.ok }, { tone: "warn", label: STATUS_WORD.warn }, { tone: "bad", label: STATUS_WORD.bad }, { tone: "none", label: STATUS_WORD.none }];
}

export function landscapeModel(rows: readonly Row[], metric: string): Landscape {
  const m = metricOf(metric);
  const label = m.key === "worst" ? m.label : m.key === "tier" || m.key === "q" ? m.label : PILLAR_LABEL[PILLARS[Number(m.key.charAt(1))]!];
  const doms = new Map<string, Map<string, Tile[]>>();
  for (const r of rows) {
    const dom = facetValuesOf(r, "dom")[0]!;
    const sd = r.app.subdomain == null ? "" : String(r.app.subdomain).trim();
    const g = sd === "" ? OTHER_GROUP : sd;
    let groups = doms.get(dom);
    if (!groups) { groups = new Map(); doms.set(dom, groups); }
    const { tone, value } = toneOf(r, m.key);
    const tile: Tile = { id: r.app.id, name: r.app.name, tone, tip: r.app.name + " · " + label + ": " + value };
    const list = groups.get(g);
    if (list) list.push(tile); else groups.set(g, [tile]);
  }
  const domains: LandscapeDomain[] = [...doms.entries()].map(([name, groups]) => {
    const gs: LandscapeGroup[] = [...groups.entries()].map(([gname, tiles]) => {
      tiles.sort((a, b) => cmpName(a.name, b.name) || byName(a.id, b.id));
      return { name: gname, apps: tiles.length, tiles };
    });
    gs.sort((a, b) => b.apps - a.apps || cmpName(a.name, b.name));
    return { name, apps: gs.reduce((n, g) => n + g.apps, 0), groups: gs };
  });
  domains.sort((a, b) => b.apps - a.apps || cmpName(a.name, b.name));
  return { total: rows.length, metric: m.key, domains };
}
