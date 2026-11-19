// The list and export column registry, matching the approved list mockup's COLDEF. Application
// is fixed (it cannot be hidden). The kit's tableModel reads `key`, `label`, `pinned` and `hidden`
// (here `defaultHidden`, mapped by kitColumns); the rest is ours: how a column sorts and what it exports.

import { PILLARS } from "./types";
import { parseDeviations, toggleColumn, visibleColumns } from "@gas-kit/ui/components/tableModel.js";
import type { Row } from "./facets";
import { PILLAR_LABEL, STATUS_WORD, lifecycleLabel } from "./facets";

export type ExportCell = string | number;

export interface Column {
  key: string;
  label: string;
  /** Application: always drawn. */
  fixed: boolean;
  /** Read by the kit tableModel (pinned columns cannot be hidden). */
  pinned: boolean;
  /** Off until the reader turns it on (the kit's `hidden`). */
  defaultHidden: boolean;
  /** Which way a first header click sorts. */
  descFirst: boolean;
  /** Sort value; null sorts last in both directions. */
  sort: (r: Row) => string | number | null;
  /** Export header labels (one, or eight for Status). */
  heads: string[];
  /** Export cells, aligned with `heads`. */
  cells: (r: Row) => ExportCell[];
}

/** bad*100 + warn*10 over the four pillars: more gaps and warnings sort higher. */
export function statusKey(r: Row): number {
  let bad = 0;
  let warn = 0;
  for (const p of PILLARS) {
    const s = r.status[p].status;
    if (s === "bad") bad++;
    else if (s === "warn") warn++;
  }
  return bad * 100 + warn * 10;
}

/** Known lifecycles in life order; anything else sorts after them. */
const LIFECYCLE_ORDER = ["ALPHA", "BETA", "EARLY_ACCESS", "GENERAL_AVAILABILITY", "PRODUCTION", "END_OF_GROWTH", "DECOMMISSIONING", "END_OF_SUPPORT", "END_OF_LIFE"];
export function lifecycleIndex(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const i = LIFECYCLE_ORDER.indexOf(v.trim().toUpperCase().replace(/[\s-]+/g, "_"));
  return i < 0 ? LIFECYCLE_ORDER.length : i;
}

const text = (v: string | null): string => (v == null ? "" : v);
const single = (label: string, key: string, sort: Column["sort"], cells: (r: Row) => ExportCell, extra: Partial<Column> = {}): Column => ({
  key, label, fixed: false, pinned: false, defaultHidden: true, descFirst: false, sort, heads: [label], cells: (r) => [cells(r)], ...extra,
});

export const COLUMNS: readonly Column[] = [
  single("Application", "n", (r) => r.app.name.toLowerCase(), (r) => r.app.name, { fixed: true, pinned: true, defaultHidden: false }),
  single("Domain", "d", (r) => r.app.domain, (r) => r.app.domain, { defaultHidden: false }),
  single("Subdomain", "sd", (r) => r.app.subdomain, (r) => text(r.app.subdomain)),
  single("Support group", "g", (r) => r.app.supportGroup, (r) => text(r.app.supportGroup)),
  single("Tier", "t", (r) => r.app.tier, (r) => (r.app.tier ? "T" + r.app.tier : ""), { defaultHidden: false }),
  single("Lifecycle", "lc", (r) => lifecycleIndex(r.app.lifecycle), (r) => (r.app.lifecycle ? lifecycleLabel(r.app.lifecycle) : ""), { defaultHidden: false }),
  single("Owner", "o", (r) => r.app.owner, (r) => text(r.app.owner), { defaultHidden: false }),
  single("Security officer", "so", (r) => r.app.securityOfficer, (r) => text(r.app.securityOfficer), { defaultHidden: false }),
  single("Typology", "ty", (r) => r.app.typology, (r) => text(r.app.typology)),
  single("Hosting", "h", (r) => r.app.hosting, (r) => text(r.app.hosting)),
  {
    key: "st", label: "Status", fixed: false, pinned: false, defaultHidden: false, descFirst: true,
    sort: statusKey,
    heads: [...PILLARS.map((p) => PILLAR_LABEL[p]), ...PILLARS.map((p) => PILLAR_LABEL[p] + " reason")],
    cells: (r) => [...PILLARS.map((p) => STATUS_WORD[r.status[p].status]), ...PILLARS.map((p) => r.status[p].sentence)],
  },
  // Off by default: the four status columns carry the Inventory; turn it on from Columns.
  single("Completeness", "q", (r) => r.pct, (r) => r.pct, { defaultHidden: true }),
];

export const COLUMN_BY_KEY: Readonly<Record<string, Column>> = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const COLUMN_KEYS: readonly string[] = COLUMNS.map((c) => c.key);
export const DEFAULT_COLUMN_KEYS: readonly string[] = COLUMNS.filter((c) => !c.defaultHidden).map((c) => c.key);
export const DEFAULT_SORT = "n";

export function isColumnKey(k: unknown): k is string {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(COLUMN_BY_KEY, k);
}

/**
 * The kit's column shape for the registry. `hidden` is the default AS THE SORT LEAVES IT: a column that
 * is off by default but is the one the list is sorted by is on screen, so the order always has a
 * column that explains it. A reader's own '-key' still wins over that.
 */
function kitColumns(sortKey?: string): { key: string; label: string; pinned: boolean; hidden: boolean }[] {
  return COLUMNS.map((c) => ({ key: c.key, label: c.label, pinned: c.pinned, hidden: c.defaultHidden && c.key !== sortKey }));
}

/**
 * A reader's column choice as signed deviations from the defaults ('-key' hidden, '+key' shown), the
 * form held in ViewState.cols, in the URL and under 'cccp.cols'. Unknown keys and pinned columns are
 * dropped; an unsigned key reads as hidden (a hand-typed '?cols=so'); a key both hidden and shown is
 * shown. The result is canonical: hidden keys then shown keys, each in column order.
 */
export function deviationsOf(signed: readonly string[]): string[] {
  const signedAll = signed.filter((k) => typeof k === "string" && k !== "").map((k) => (k[0] === "-" || k[0] === "+" ? k : "-" + k));
  const kept = parseDeviations(signedAll, kitColumns()) as string[];
  const on = new Set(kept.filter((k) => k[0] === "+").map((k) => k.slice(1)));
  const off = new Set(kept.filter((k) => k[0] === "-").map((k) => k.slice(1)).filter((k) => !COLUMN_BY_KEY[k]!.pinned && !on.has(k)));
  return COLUMN_KEYS.filter((k) => off.has(k)).map((k) => "-" + k).concat(COLUMN_KEYS.filter((k) => on.has(k)).map((k) => "+" + k));
}

/** The columns drawn for a choice, in registry order. A sort on a hidden-by-default column shows it. */
export function visibleColumnDefs(signed: readonly string[], sortKey?: string): Column[] {
  const shown = new Set((visibleColumns(kitColumns(sortKey), deviationsOf(signed)) as { key: string }[]).map((c) => c.key));
  return COLUMNS.filter((c) => shown.has(c.key)) as Column[];
}

/** Toggle one column in the signed list; Application (pinned) and unknown keys do nothing. */
export function toggleColumnKey(signed: readonly string[], key: string, sortKey?: string): string[] {
  return deviationsOf(toggleColumn(kitColumns(sortKey), deviationsOf(signed), key) as string[]);
}
