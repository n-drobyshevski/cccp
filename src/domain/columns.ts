// The list and export column registry, matching the approved list mockup's COLDEF. Application
// is fixed (it cannot be hidden). The vendored tableModel reads `key`, `label`, `pinned` and
// `defaultHidden`; the rest is ours: how a column sorts and what it exports.

import { PILLARS } from "./types";
import { encodeColumnChoice, parseColumnChoice, toggleColumn, visibleColumns } from "../vendor/gas_shared/ui/tableModel";
import type { Row } from "./facets";
import { PILLAR_LABEL, STATUS_WORD, lifecycleLabel } from "./facets";

export type ExportCell = string | number;

export interface Column {
  key: string;
  label: string;
  /** Application: always drawn. */
  fixed: boolean;
  /** Read by the vendored tableModel (pinned columns cannot be hidden). */
  pinned: boolean;
  /** Off until the reader turns it on (read by tableModel). */
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
  single("Completeness", "q", (r) => r.pct, (r) => r.pct, { defaultHidden: false }),
  {
    key: "st", label: "Status", fixed: false, pinned: false, defaultHidden: false, descFirst: true,
    sort: statusKey,
    heads: [...PILLARS.map((p) => PILLAR_LABEL[p]), ...PILLARS.map((p) => PILLAR_LABEL[p] + " reason")],
    cells: (r) => [...PILLARS.map((p) => STATUS_WORD[r.status[p].status]), ...PILLARS.map((p) => r.status[p].sentence)],
  },
];

export const COLUMN_BY_KEY: Readonly<Record<string, Column>> = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const COLUMN_KEYS: readonly string[] = COLUMNS.map((c) => c.key);
export const DEFAULT_COLUMN_KEYS: readonly string[] = COLUMNS.filter((c) => !c.defaultHidden).map((c) => c.key);
export const DEFAULT_SORT = "n";

export function isColumnKey(k: unknown): k is string {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(COLUMN_BY_KEY, k);
}

/** A reader's column choice: signed deviations from the defaults ('-key' hidden, '+key' shown). */
export type ColumnChoice = { off: string[]; on: string[] };

/** Signed keys (as held in ViewState.cols) to a choice; unknown keys are dropped. */
export function choiceOf(signed: readonly string[]): ColumnChoice {
  const c = parseColumnChoice(signed.join(","));
  return { off: c.off.filter((k: string) => isColumnKey(k) && !COLUMN_BY_KEY[k]!.pinned), on: c.on.filter(isColumnKey) };
}

/** The choice back to signed keys, in column order. */
export function signedKeys(choice: ColumnChoice): string[] {
  const text = encodeColumnChoice(choice);
  return text === "" ? [] : text.split(",");
}

/** The columns drawn for a choice, in registry order. A sort on a hidden-by-default column shows it. */
export function visibleColumnDefs(signed: readonly string[], sortKey?: string): Column[] {
  return visibleColumns(COLUMNS as Column[], choiceOf(signed), sortKey) as Column[];
}

/** Toggle one column in the signed list; the vendored rules keep Application and at least one column. */
export function toggleColumnKey(signed: readonly string[], key: string, sortKey?: string): string[] {
  const next = toggleColumn(COLUMNS as Column[], choiceOf(signed), key, sortKey) as ColumnChoice;
  return signedKeys(next);
}
