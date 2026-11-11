import { monthsBetween } from "./dates";
import type { AppRecord, FieldKey } from "./types";

// Data quality: the completeness percentage over the mandatory fields, grouped as in the approved
// lx.ext.html mockup (QF), and the review seal.

export interface QualityItem { label: string; field: FieldKey; present: (a: AppRecord) => boolean }
export interface QualityGroup { name: string; items: readonly QualityItem[] }

const filled = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
const item = (label: string, field: FieldKey, present: (a: AppRecord) => boolean): QualityItem => ({ label, field, present });

/** One entry per mandatory field of fields.ts (a test keeps the two in step). */
export const QF: readonly QualityGroup[] = [
  { name: "Cyber", items: [
    item("Front exposed on internet", "exposed", (a) => a.exposed !== null),
    item("Last pentest", "lastPentest", (a) => filled(a.lastPentest)),
    item("Security officer", "securityOfficer", (a) => filled(a.securityOfficer)),
  ] },
  { name: "Compliance", items: [
    item("CIAT levels", "ciatC", (a) => a.ciat.c !== null),
    item("Personal data", "personalData", (a) => a.personalData !== null),
    item("Date of security check", "securityCheck", (a) => filled(a.securityCheck)),
    item("Last audit", "lastAudit", (a) => filled(a.lastAudit)),
  ] },
  { name: "Continuity", items: [
    item("Max tolerable downtime", "mtd", (a) => a.mtd !== null),
    item("Recovery time objective", "rto", (a) => a.rto !== null),
    item("Recovery point objective", "rpo", (a) => a.rpo !== null),
    item("Last DRP test", "lastDrpTest", (a) => filled(a.lastDrpTest)),
  ] },
  { name: "Platform", items: [
    item("Tiering", "tier", (a) => a.tier !== null),
    item("Hosting type", "hosting", (a) => filled(a.hosting)),
    item("Typology", "typology", (a) => filled(a.typology)),
    item("Single sign-on", "sso", (a) => a.sso !== null),
  ] },
  { name: "People", items: [
    item("Owner", "owner", (a) => filled(a.owner)),
    item("Backup owner", "backupOwner", (a) => filled(a.backupOwner)),
  ] },
];

export interface QualityGroupResult {
  name: string;
  pct: number;
  items: { label: string; field: FieldKey; ok: boolean }[];
}

export interface Completeness {
  /** Whole-record percentage, 0..100, rounded. */
  pct: number;
  filled: number;
  total: number;
  groups: QualityGroupResult[];
  /** Labels of the missing fields, in group order. */
  missing: string[];
}

/** Completeness of one application over the QF groups. */
export function completeness(a: AppRecord): Completeness {
  let t = 0;
  let f = 0;
  const missing: string[] = [];
  const groups = QF.map((g) => {
    const items = g.items.map((i) => ({ label: i.label, field: i.field, ok: i.present(a) }));
    const y = items.filter((i) => i.ok).length;
    t += items.length;
    f += y;
    for (const i of items) if (!i.ok) missing.push(i.label);
    return { name: g.name, pct: Math.round((y / items.length) * 100), items };
  });
  return { pct: Math.round((f / t) * 100), filled: f, total: t, groups, missing };
}

export type QualityLevel = "bad" | "warn" | "ok";

/** Below 50 is bad, below 80 is warn, else ok. */
export function qualityLevel(pct: number): QualityLevel {
  return pct < 50 ? "bad" : pct < 80 ? "warn" : "ok";
}

export interface ReviewSeal {
  state: "need" | "done";
  label: "Review needed" | "Reviewed";
  reason: "no-check" | "stale" | "current";
}

/**
 * 'Review needed' when the date of the security check is missing or older than `months`
 * (co.review.months, 30.4375 days per month); otherwise 'Reviewed'. It flips exactly when the age
 * passes the interval: at 12 months, 365 days is still reviewed and 366 needs review.
 */
export function reviewSeal(a: AppRecord, months: number, today: string): ReviewSeal {
  if (!filled(a.securityCheck)) return { state: "need", label: "Review needed", reason: "no-check" };
  const m = monthsBetween(a.securityCheck, today);
  if (m === null) return { state: "need", label: "Review needed", reason: "no-check" };
  return m > months
    ? { state: "need", label: "Review needed", reason: "stale" }
    : { state: "done", label: "Reviewed", reason: "current" };
}
