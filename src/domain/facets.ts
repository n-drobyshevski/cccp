// The filter dimensions of the register and the row shape every list, heatmap and landscape
// query runs over. Pure: no clock, no DOM. Search text and facet buckets are derived from an
// AppRecord and its already-evaluated status, so the same row feeds filters, sort and export.

import type { AppRecord, FacetKey, Pillar, Status } from "./types";
import { PILLARS } from "./types";
import type { AppStatus } from "./rules";

export const FACET_KEYS: readonly FacetKey[] = ["dom", "sd", "tier", "lc", "so", "gap", "ty", "h"];

export const PILLAR_LABEL: Readonly<Record<Pillar, string>> = {
  cyber: "Cyber", compliance: "Compliance", continuity: "Continuity", platform: "Platform",
};
export const STATUS_WORD: Readonly<Record<Status, string>> = {
  bad: "Gap", warn: "Needs attention", ok: "OK", none: "No data",
};

/** A register row: the record, its evaluated status, its completeness and its search text. */
export interface Row {
  app: AppRecord;
  status: AppStatus;
  /** Completeness, 0..100. */
  pct: number;
  /** Folded text of the seven searchable fields. */
  text: string;
}

export const TIER_ORDER: readonly string[] = ["T1", "T2", "T3", "T4", "No tier"];
export const GAP_ORDER: readonly string[] = PILLARS.map((p) => PILLAR_LABEL[p]);
export const NONE_ASSIGNED = "None assigned";
export const NO_SUBDOMAIN = "No subdomain";
export const NOT_SET = "Not set";
export const NO_TIER = "No tier";
/** Buckets that stand for "unknown": they sort after every real value. */
const LAST_BUCKETS: ReadonlySet<string> = new Set([NONE_ASSIGNED, NO_SUBDOMAIN, NOT_SET, "NO DOMAIN"]);

export interface FacetDef {
  key: FacetKey;
  label: string;
  /** Long lists get a find box. */
  big: boolean;
  /** A fixed value order, or null for alphabetical with the unknown bucket last. */
  order: readonly string[] | null;
  values: (r: Row) => string[];
}

/** 'END_OF_LIFE' becomes 'End of life'. */
export function lifecycleLabel(v: string): string {
  const t = v.trim().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

const blank = (v: string | null | undefined, fallback: string): string => {
  const t = v == null ? "" : String(v).trim();
  return t === "" ? fallback : t;
};

export const FACETS: readonly FacetDef[] = [
  { key: "dom", label: "Domain", big: true, order: null, values: (r) => [blank(r.app.domain, "NO DOMAIN")] },
  { key: "sd", label: "Subdomain", big: true, order: null, values: (r) => [blank(r.app.subdomain, NO_SUBDOMAIN)] },
  { key: "tier", label: "Tier", big: false, order: TIER_ORDER, values: (r) => [r.app.tier ? "T" + r.app.tier : NO_TIER] },
  { key: "lc", label: "Lifecycle", big: false, order: null, values: (r) => [r.app.lifecycle && r.app.lifecycle.trim() ? lifecycleLabel(r.app.lifecycle) : NOT_SET] },
  { key: "so", label: "Security officer", big: true, order: null, values: (r) => [blank(r.app.securityOfficer, NONE_ASSIGNED)] },
  // A gap means a 'bad' status in that pillar; an app with several gaps counts under each.
  { key: "gap", label: "Gap in", big: false, order: GAP_ORDER, values: (r) => PILLARS.filter((p) => r.status[p].status === "bad").map((p) => PILLAR_LABEL[p]) },
  { key: "ty", label: "Typology", big: false, order: null, values: (r) => [blank(r.app.typology, NOT_SET)] },
  { key: "h", label: "Hosting", big: false, order: null, values: (r) => [blank(r.app.hosting, NOT_SET)] },
];

export const FACET_BY_KEY: Readonly<Record<FacetKey, FacetDef>> = Object.fromEntries(FACETS.map((f) => [f.key, f])) as Record<FacetKey, FacetDef>;

export function isFacetKey(k: unknown): k is FacetKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(FACET_BY_KEY, k);
}

/** Lower-case and strip accents, so 'Zoé' and 'zoe' are the same search. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The seven searchable fields. */
export function searchText(a: AppRecord): string {
  return fold([a.name, a.domain, a.subdomain, a.supportGroup, a.owner, a.backupOwner, a.securityOfficer]
    .map((v) => (v == null ? "" : String(v))).join(" "));
}

export function makeRow(app: AppRecord, status: AppStatus, pct: number): Row {
  return { app, status, pct, text: searchText(app) };
}

/** The buckets of one row under one facet. */
export function facetValuesOf(r: Row, key: FacetKey): string[] {
  return FACET_BY_KEY[key].values(r);
}

function compareLabels(a: string, b: string): number {
  const la = LAST_BUCKETS.has(a) ? 1 : 0;
  const lb = LAST_BUCKETS.has(b) ? 1 : 0;
  if (la !== lb) return la - lb;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** Every value present in `rows` for a facet, in display order. */
export function facetValues(rows: readonly Row[], key: FacetKey): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const v of facetValuesOf(r, key)) seen.add(v);
  const order = FACET_BY_KEY[key].order;
  if (order) return order.filter((v) => seen.has(v));
  return [...seen].sort(compareLabels);
}
