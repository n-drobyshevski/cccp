// The application fact sheet model: header, the five sections (Overview and the four pillars, each
// with titled subsections), the people roles and the data-quality sidebar. Pure: no clock, no DOM.
// Whatever is unknown stays null and the view draws it as a muted dash; nothing is coerced.
// Ported from the approved lx2.ext.html Sections page with data quality on.

import type { AppRecord, Level, Pillar, Status } from "./types";
import { PILLARS } from "./types";
import type { Row } from "./facets";
import { PILLAR_LABEL, STATUS_WORD, lifecycleLabel, makeRow } from "./facets";
import { relativeAge } from "./dates";
import { completeness, qualityLevel, reviewSeal } from "./quality";
import type { Completeness, QualityLevel, ReviewSeal } from "./quality";
import { DEFAULT_RULES, evaluateAll } from "./rules";
import type { RulesSettings } from "./types";

/** What the model needs besides the row: the clock, the review interval and the Sheet link. */
export interface FsContext {
  /** yyyy-MM-dd in the Sheet's zone. */
  today: string;
  /** co.review months; the review seal flips when the age passes it. */
  reviewMonths: number;
  /** sourceMeta.url and the gid of the Apps tab; null when unknown. */
  sheetUrl?: string | null;
  sheetGid?: number | null;
}

export type SectionKey = "overview" | "cyber" | "compliance" | "continuity" | "platform";
export const SECTION_KEYS: readonly SectionKey[] = ["overview", "cyber", "compliance", "continuity", "platform"];
export const SECTION_TITLE: Readonly<Record<SectionKey, string>> = {
  overview: "Overview", cyber: "Cyber", compliance: "Compliance", continuity: "Continuity", platform: "Platform",
};

export type FsTone = "ok" | "warn" | "bad" | "";
/** How the view draws a value. A null value is always the muted dash. */
export type FsKind = "text" | "yn" | "date" | "res" | "tier" | "hours" | "person" | "lc";
export interface FsRow {
  label: string;
  kind: FsKind;
  value: string | number | null;
  tone?: FsTone;
  /** A Yes that is a risk (drawn bold). */
  risk?: boolean;
  /** '5 months ago' for a date. */
  age?: string;
}

export interface LifecycleStep { label: string; state: "done" | "cur" | "end" | "todo" }
export type FsWidget =
  | { type: "ciat"; levels: { key: "C" | "I" | "A" | "T"; label: string; level: Level | null }[] | null }
  | { type: "rto"; rto: number | null; mtd: number | null }
  | { type: "stepper"; steps: LifecycleStep[] };

export interface FsSubsection { key: string; title: string; widget: FsWidget | null; rows: FsRow[] }
export interface FsSection {
  key: SectionKey;
  title: string;
  status: Status | null;
  /** The sentence of the pillar's verdict; null for Overview. */
  why: string | null;
  /** Completeness of the pillar's mandatory fields; null for Overview. */
  pct: number | null;
  subsections: FsSubsection[];
}

export interface FsStatus { pillar: Pillar; label: string; status: Status; word: string; why: string; section: SectionKey }
export interface FsTag { key: "ty" | "h" | "ex" | "pd" | "sso"; label: string }

export interface FsHeader {
  id: string;
  name: string;
  domain: string;
  subline: string;
  tier: Level | null;
  lifecycle: { key: string; label: string } | null;
  completeness: { pct: number; filled: number; total: number; level: QualityLevel };
  seal: ReviewSeal & { tip: string };
  tags: FsTag[];
  statuses: FsStatus[];
  /** Where Open row in sheet goes, or null when the row or the Sheet is unknown. */
  sheetLink: string | null;
}

export interface FsPerson { role: string; name: string | null; about: string; flag: string | null }
export interface FsDq {
  pct: number;
  filled: number;
  total: number;
  level: QualityLevel;
  review: ReviewSeal & { tip: string };
  groups: Completeness["groups"];
}

export interface FactSheet {
  header: FsHeader;
  sections: FsSection[];
  people: { count: number; rows: FsPerson[] };
  dq: FsDq;
}

const filled = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const text = (v: string | null | undefined): string | null => (filled(v) ? String(v).trim() : null);
const yn = (v: boolean | null): string | null => (v === null ? null : v ? "Yes" : "No");

const lifecycleKey = (v: string | null | undefined): string => String(v == null ? "" : v).trim().toUpperCase().replace(/[\s-]+/g, "_");

export const LIFECYCLE_STEPS: readonly string[] = ["Early access", "Beta", "General availability", "End of growth", "Decommissioning", "End of life"];
const LIFECYCLE_INDEX: Readonly<Record<string, number>> = {
  ALPHA: 0, EARLY_ACCESS: 0, BETA: 1, GENERAL_AVAILABILITY: 2, PRODUCTION: 2, END_OF_GROWTH: 3,
  END_OF_SUPPORT: 4, DECOMMISSIONING: 4, END_OF_LIFE: 5,
};

/** The six lifecycle steps with the current one marked; an unrecognised value marks none. */
export function lifecycleSteps(lifecycle: string | null): LifecycleStep[] {
  const c = lifecycle === null ? undefined : LIFECYCLE_INDEX[lifecycleKey(lifecycle)];
  return LIFECYCLE_STEPS.map((label, i) => ({
    label,
    state: c === undefined ? "todo" : i < c ? "done" : i === c ? (i >= 4 ? "end" : "cur") : "todo",
  }));
}

/** The tone of a free-text result (audit or findings): none and passed are fine, major or critical are not. */
export function resultTone(t: string | null, counts?: { critical?: number | null; high?: number | null; major?: number | null }): FsTone {
  if (t === null) return "";
  // The parsed counts are what the rules use, so the colour follows them when they are known.
  if (counts) {
    const known = [counts.critical, counts.high, counts.major].filter((c) => c != null) as number[];
    if (known.length > 0) {
      if ((counts.critical ?? 0) > 0 || (counts.major ?? 0) > 0) return "bad";
      if ((counts.high ?? 0) > 0) return "warn";
      // Counted and none of them is severe: a keyword in the text ('0 major') is not a finding.
      if (/critical|major|high/i.test(t) && !/failed|passed|none/i.test(t) && known.every((c) => c === 0)) return "ok";
    }
  }
  if (/passed|none/i.test(t)) return "ok";
  if (/critical|major|failed/i.test(t)) return "bad";
  if (/high/i.test(t)) return "warn";
  return "";
}

const res = (label: string, value: string | null, counts?: Parameters<typeof resultTone>[1]): FsRow => ({ label, kind: "res", value, tone: resultTone(value, counts) });
const plain = (label: string, value: string | null): FsRow => ({ label, kind: "text", value });
const flag = (label: string, v: boolean | null, risk = false): FsRow => ({ label, kind: "yn", value: yn(v), risk: v === true && risk });
const date = (label: string, v: string | null, today: string): FsRow => {
  const d = text(v);
  return { label, kind: "date", value: d, age: d ? relativeAge(d, today) : "" };
};
const hours = (label: string, v: number | null): FsRow => ({ label, kind: "hours", value: v });
const sub = (key: string, title: string, rows: FsRow[], widget: FsWidget | null = null): FsSubsection => ({ key, title, widget, rows });

const CIAT_LABELS: ReadonlyArray<["C" | "I" | "A" | "T", string]> = [["C", "Confidentiality"], ["I", "Integrity"], ["A", "Availability"], ["T", "Traceability"]];

/** The title of the data-quality side panel, shared with the loading skeleton. */
export const DQ_TITLE = "Data quality";

/**
 * The fixed words of a fact sheet, section by section and field by field, read off the model of
 * a blank application so the loading skeleton can never drift from the real page.
 */
export function factsheetOutline(): { key: SectionKey; title: string; labels: string[] }[] {
  const blank = {
    id: "", name: "", domain: "", subdomain: null, supportGroup: null, owner: null, backupOwner: null,
    securityOfficer: null, lifecycle: null, typology: null, tier: null, exposed: null, lastPentest: null,
    findingsText: null, findingsCritical: null, findingsHigh: null, ciat: { c: null, i: null, a: null, t: null },
    personalData: null, personalSensitive: null, companySensitive: null, securityCheck: null, lastAudit: null,
    auditResult: null, auditMajor: null, mtd: null, rto: null, rpo: null, lastDrpTest: null, drpResult: null,
    hosting: null, sso: null, internalUsers: null, externalUsers: null, _row: {},
  } as AppRecord;
  const today = "2000-01-01";
  const row = makeRow(blank, evaluateAll([blank], DEFAULT_RULES, today)[0]!, 0);
  return factsheetModel(row, { today, reviewMonths: reviewMonthsOf(DEFAULT_RULES) }).sections.map((s) => ({
    key: s.key, title: s.title, labels: s.subsections.flatMap((u) => u.rows.map((r) => r.label)),
  }));
}

/** The review interval of the rules, in months. */
export function reviewMonthsOf(rules: RulesSettings | null | undefined): number {
  const own = rules && rules.rules ? rules.rules["co.review"] : undefined;
  const base = DEFAULT_RULES.rules["co.review"]!.months as number;
  return own && typeof own.months === "number" && own.months > 0 ? own.months : base;
}

/** The URL Open row in sheet goes to: the Sheet, the Apps tab and the application's row. */
export function sheetRowLink(url: string | null | undefined, gid: number | null | undefined, row: number | undefined): string | null {
  if (!url || row === undefined || !Number.isInteger(row) || row < 1) return null;
  if (!/^https:[^\s<>"'#]+$/.test(url)) return null;
  const parts: string[] = [];
  if (gid !== null && gid !== undefined && Number.isInteger(gid)) parts.push("gid=" + gid);
  parts.push("range=A" + row);
  return url + "#" + parts.join("&");
}

function sealOf(row: Row, ctx: FsContext): ReviewSeal & { tip: string } {
  const s = reviewSeal(row.app, ctx.reviewMonths, ctx.today);
  return { ...s, tip: filled(row.app.securityCheck) ? "Last security check " + row.app.securityCheck : "No security check on record" };
}

export function factsheetModel(row: Row, ctx: FsContext): FactSheet {
  const a = row.app;
  const q = completeness(a);
  const level = qualityLevel(q.pct);

  const tags: FsTag[] = [];
  if (filled(a.typology)) tags.push({ key: "ty", label: a.typology!.trim() });
  if (filled(a.hosting)) tags.push({ key: "h", label: a.hosting!.trim() });
  if (a.exposed === true) tags.push({ key: "ex", label: "Internet exposed" });
  if (a.personalData === true) tags.push({ key: "pd", label: "Personal data" });
  if (a.sso === false) tags.push({ key: "sso", label: "No SSO" });

  const statuses: FsStatus[] = PILLARS.map((p) => ({
    pillar: p, label: PILLAR_LABEL[p], status: row.status[p].status, word: STATUS_WORD[row.status[p].status], why: row.status[p].sentence, section: p,
  }));

  const sd = text(a.subdomain);
  const sg = text(a.supportGroup);
  const subline = [text(a.domain) === null ? null : a.domain + (sd ? " › " + sd : ""), sg].filter((x) => x !== null).join(" · ");

  const lc = text(a.lifecycle);
  const header: FsHeader = {
    id: a.id,
    name: a.name,
    domain: a.domain,
    subline,
    tier: a.tier,
    lifecycle: lc === null ? null : { key: lifecycleKey(lc), label: lifecycleLabel(lc) },
    completeness: { pct: q.pct, filled: q.filled, total: q.total, level },
    seal: sealOf(row, ctx),
    tags,
    statuses,
    sheetLink: sheetRowLink(ctx.sheetUrl, ctx.sheetGid, a._row.apps),
  };

  const classified = a.ciat.c !== null || a.ciat.i !== null || a.ciat.a !== null || a.ciat.t !== null;
  const security = text(a.securityOfficer);
  const validated: FsRow = !classified
    ? { label: "Validated by security officer", kind: "res", value: null }
    : filled(a.securityCheck)
      ? { label: "Validated by security officer", kind: "res", value: "Reviewed and validated", tone: "ok" }
      : { label: "Validated by security officer", kind: "res", value: "Not validated", tone: "warn" };

  const byKey: Record<SectionKey, FsSubsection[]> = {
    overview: [
      sub("identity", "Identity", [
        plain("Domain", text(a.domain)), plain("Subdomain", sd), plain("Support group", sg),
        { label: "Tier", kind: "tier", value: a.tier }, plain("Typology", text(a.typology)),
      ]),
    ],
    cyber: [
      sub("exposure", "Exposure", [flag("Front exposed on internet", a.exposed, !filled(a.lastPentest)), plain("External users", text(a.externalUsers))]),
      sub("testing", "Testing", [date("Last pentest", a.lastPentest, ctx.today), res("Open findings", text(a.findingsText), { critical: a.findingsCritical, high: a.findingsHigh })]),
      sub("ownership", "Ownership", [
        security === null ? { label: "Security officer", kind: "res", value: "None assigned", tone: "bad" } : { label: "Security officer", kind: "person", value: security },
      ]),
    ],
    compliance: [
      sub("classification", "Classification", [], { type: "ciat", levels: classified ? CIAT_LABELS.map(([key, label]) => ({ key, label, level: a.ciat[key.toLowerCase() as "c" | "i" | "a" | "t"] })) : null }),
      sub("data", "Data", [flag("Personal data", a.personalData), flag("Personal sensitive data", a.personalSensitive), flag("Company sensitive data", a.companySensitive)]),
      sub("review", "Review", [date("Date of security check", a.securityCheck, ctx.today), validated]),
      sub("audit", "Audit", [date("Last audit", a.lastAudit, ctx.today), res("Audit result", text(a.auditResult), { major: a.auditMajor })]),
    ],
    continuity: [
      sub("recovery", "Recovery objectives", [hours("Max tolerable downtime", a.mtd), hours("Recovery time objective", a.rto), hours("Recovery point objective", a.rpo)],
        a.rto === null ? null : { type: "rto", rto: a.rto, mtd: a.mtd }),
      sub("drp", "DRP testing", [
        date("Last DRP test", a.lastDrpTest, ctx.today),
        res("Test result", a.drpResult === null ? null : a.drpResult === "passed" ? "Passed" : "Failed"),
      ]),
    ],
    platform: [
      sub("hosting", "Hosting", [
        plain("Hosting type", text(a.hosting)), plain("Typology", text(a.typology)),
        a.sso === false ? { label: "Single sign-on", kind: "res", value: "No", tone: "warn" } : plain("Single sign-on", yn(a.sso)),
      ]),
      sub("usage", "Usage", [plain("Internal users", text(a.internalUsers)), plain("External users", text(a.externalUsers))]),
      sub("lifecycle", "Lifecycle", lc === null ? [{ label: "Lifecycle", kind: "lc", value: null }] : [], lc === null ? null : { type: "stepper", steps: lifecycleSteps(lc) }),
    ],
  };

  const sections: FsSection[] = SECTION_KEYS.map((key, i) => {
    const p = i === 0 ? null : PILLARS[i - 1]!;
    return {
      key,
      title: SECTION_TITLE[key],
      status: p ? row.status[p].status : null,
      why: p ? row.status[p].sentence : null,
      pct: p ? q.groups[i - 1]!.pct : null,
      subsections: byKey[key],
    };
  });

  const owner = text(a.owner);
  const backup = text(a.backupOwner);
  const people: FsPerson[] = ([
    ["Owner", owner, "Accountable for the application and its risks"],
    ["Backup owner", backup, "Stands in for the owner"],
    ["Security officer", security, "Validates the classification and follows up findings"],
  ] as const).map(([role, name, about]) => ({ role, name, about, flag: name === null ? "None assigned" : null }));

  return {
    header,
    sections,
    people: { count: people.filter((p) => p.name !== null).length, rows: people },
    dq: { pct: q.pct, filled: q.filled, total: q.total, level, review: sealOf(row, ctx), groups: q.groups },
  };
}

// ------------------------------------------------------------------------------------ find

const rowText = (r: FsRow): string => (r.label + " " + (r.value === null ? "" : String(r.value)) + " " + (r.age || "")).toLowerCase();

/**
 * Narrow the sections to a find query: a section whose title matches stays whole; otherwise only
 * the subsections whose title matches, or the rows whose label or value matches, remain. Widgets
 * stay with a subsection that survives. An empty query returns the sections unchanged.
 */
export function findInSections(sections: readonly FsSection[], query: string): { sections: FsSection[]; hits: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { sections: [...sections], hits: sections.length };
  const out: FsSection[] = [];
  let hits = 0;
  for (const s of sections) {
    if (s.title.toLowerCase().includes(q)) { out.push(s); hits++; continue; }
    const subs: FsSubsection[] = [];
    for (const u of s.subsections) {
      if (u.title.toLowerCase().includes(q)) { subs.push(u); hits++; continue; }
      const rows = u.rows.filter((r) => rowText(r).includes(q));
      const widgetHit = u.widget && u.widget.type === "ciat" && /confidential|integrity|availability|traceability|classif/.test(q) && CIAT_LABELS.some(([, l]) => l.toLowerCase().includes(q));
      if (rows.length || widgetHit) { subs.push({ ...u, rows: widgetHit ? u.rows : rows }); hits += rows.length || 1; }
    }
    if (subs.length) out.push({ ...s, subsections: subs });
  }
  return { sections: out, hits };
}

// ------------------------------------------------------------------------------------ recent

export const RECENT_MAX = 8;

/** The stored list after opening `id`: it first, no repeat, the current one plus RECENT_MAX others. */
export function pushRecent(list: readonly unknown[], id: string): string[] {
  const out = [id];
  for (const x of list) if (typeof x === "string" && x !== id && !out.includes(x)) out.push(x);
  return out.slice(0, RECENT_MAX + 1);
}

/** What the sidebar shows: up to RECENT_MAX applications, never the one being viewed. */
export function recentFor(list: readonly unknown[], current: string): string[] {
  const out: string[] = [];
  for (const x of list) if (typeof x === "string" && x !== current && !out.includes(x)) out.push(x);
  return out.slice(0, RECENT_MAX);
}
