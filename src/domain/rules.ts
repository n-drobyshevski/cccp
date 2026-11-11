import { monthsBetween } from "./dates";
import { cleanRulesSection, DEFAULT_SETTINGS, MONTHS_MAX, MONTHS_MIN, RULE_PARAMS } from "./settings";
import type { AppRecord, Pillar, RuleParams, RulesSettings, Status } from "./types";
import { PILLARS } from "./types";

// The status rules: ONE pure module compiled into both bundles (client register, Settings live
// counts with draft params, server export). There is no mirror. `today` is always injected as a
// 'yyyy-MM-dd' string. Every test is null-safe: an unknown input never fires a rule.

/** Bumped when the catalogue or its semantics change, so stored census snapshots can be told apart. */
export const RULES_VERSION = 1;

export type RuleLevel = "bad" | "warn";

/** The parameters a rule test sees: months and tiers already resolved against the defaults. */
export interface ResolvedParams { months?: number; tiers?: number[] }

export interface Rule {
  id: string;
  pillar: Pillar;
  level: RuleLevel;
  /** True when the rule has an on/off switch in Settings. A fixed rule is always on. */
  toggle: boolean;
  /** The default parameters (months and/or tiers); undefined for a rule with none. */
  params?: ResolvedParams;
  /** A fixed rule that reads the parameters of another rule (never-tested uses the tiers of drpMissing). */
  paramsFrom?: string;
  /** The sentence shown by Settings and in the application's reasons. */
  sentence: (p: ResolvedParams) => string;
  test: (app: AppRecord, p: ResolvedParams, today: string) => boolean;
}

const has = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
const gt0 = (n: number | null | undefined): boolean => typeof n === "number" && n > 0;
const word = (s: string | null | undefined, w: string): boolean => typeof s === "string" && s.toLowerCase().includes(w);

/** Findings of one kind: the parsed count when there is one, else the word in the text. */
function finds(count: number | null, text: string | null, w: string): boolean {
  return count !== null && count !== undefined ? count > 0 : word(text, w);
}

/** Older than `months` months at 30.4375 days per month. Unknown dates are never old. */
function older(day: string | null, today: string, months: number | undefined): boolean {
  if (!has(day) || months === undefined) return false;
  const m = monthsBetween(day, today);
  return m !== null && m > months;
}

const lifecycleKey = (v: string | null): string => (v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
const hasClassification = (a: AppRecord): boolean => !!a.ciat && (a.ciat.c !== null || a.ciat.i !== null || a.ciat.a !== null || a.ciat.t !== null);
const hasContinuityTarget = (a: AppRecord): boolean => a.rto !== null || a.mtd !== null;

const tierList = (t: number[] | undefined): string => (t && t.length ? t.map((x) => "T" + x).join(", ") : "no tier");

const def = (id: string): ResolvedParams | undefined => {
  const p = RULE_PARAMS[id];
  if (!p) return undefined;
  const o: ResolvedParams = {};
  if (p.months !== undefined) o.months = p.months;
  if (p.tiers !== undefined) o.tiers = [...p.tiers];
  return o.months === undefined && o.tiers === undefined ? undefined : o;
};

const r = (
  id: string, pillar: Pillar, level: RuleLevel, toggle: boolean,
  sentence: (p: ResolvedParams) => string, test: Rule["test"],
): Rule => {
  const params = def(id);
  return params ? { id, pillar, level, toggle, params, sentence, test } : { id, pillar, level, toggle, sentence, test };
};

/** The catalogue. Its order within a pillar sets `why`: the first fired rule at the worst level. */
export const RULES: readonly Rule[] = [
  // Cyber
  r("cy.noOfficer", "cyber", "bad", true, () => "No security officer assigned",
    (a) => !has(a.securityOfficer)),
  r("cy.exposedUntested", "cyber", "bad", true, () => "Exposed on the internet and never pentested",
    (a) => a.exposed === true && !has(a.lastPentest)),
  r("cy.critical", "cyber", "bad", true, () => "A critical finding is open",
    (a) => finds(a.findingsCritical, a.findingsText, "critical")),
  r("cy.high", "cyber", "warn", false, () => "A high finding is open",
    (a) => finds(a.findingsHigh, a.findingsText, "high")),
  r("cy.pentestAge", "cyber", "warn", false, (p) => "Last pentest older than " + p.months + " months",
    (a, p, today) => older(a.lastPentest, today, p.months)),
  // Compliance
  r("co.majorAudit", "compliance", "bad", true, () => "A major audit finding is open",
    (a) => finds(a.auditMajor, a.auditResult, "major")),
  r("co.review", "compliance", "warn", false, (p) => "Classification not checked in the last " + p.months + " months",
    (a, p, today) => hasClassification(a) && (!has(a.securityCheck) || monthsBetween(a.securityCheck, today) === null || older(a.securityCheck, today, p.months))),
  // Continuity
  r("ct.drpMissing", "continuity", "bad", false, (p) => "No DRP test on record for " + tierList(p.tiers),
    (a, p) => hasContinuityTarget(a) && !has(a.lastDrpTest) && a.tier !== null && (p.tiers ?? []).includes(a.tier)),
  { ...r("ct.drpNeverTested", "continuity", "warn", false, () => "No DRP test on record",
    (a, p) => hasContinuityTarget(a) && !has(a.lastDrpTest) && !(a.tier !== null && (p.tiers ?? []).includes(a.tier))),
    paramsFrom: "ct.drpMissing", params: { tiers: [1, 2] } },
  r("ct.drpFailed", "continuity", "bad", true, () => "The last DRP test failed",
    (a) => a.drpResult === "failed"),
  r("ct.drpAge", "continuity", "warn", false, (p) => "Last DRP test older than " + p.months + " months",
    (a, p, today) => older(a.lastDrpTest, today, p.months)),
  // Platform
  r("pl.eol", "platform", "bad", true, () => "End of life or end of support",
    (a) => { const k = lifecycleKey(a.lifecycle); return k === "END_OF_LIFE" || k === "END_OF_SUPPORT"; }),
  r("pl.decommissioning", "platform", "warn", false, () => "Being decommissioned",
    (a) => lifecycleKey(a.lifecycle) === "DECOMMISSIONING"),
  r("pl.noSso", "platform", "warn", true, () => "No single sign-on",
    (a) => a.sso === false),
];

export const RULE_BY_ID: Readonly<Record<string, Rule>> = Object.fromEntries(RULES.map((x) => [x.id, x]));
export const RULE_IDS: readonly string[] = RULES.map((x) => x.id);
export const DEFAULT_RULES: RulesSettings = DEFAULT_SETTINGS.rules;

/** The rules of one pillar, in catalogue order. */
export const rulesOf = (pillar: Pillar): Rule[] => RULES.filter((x) => x.pillar === pillar);

// ------------------------------------------------------------------------------------ settings

/** Drop unknown ids, clamp months to 1..120 and tiers to 1..4, fill defaults. Never throws. */
export function cleanRules(raw: unknown): RulesSettings {
  return cleanRulesSection(raw, DEFAULT_RULES);
}

/** Sentences for what is wrong in a rules section. Empty means it is fine to save. */
export function validateRules(raw: unknown): string[] {
  const out: string[] = [];
  const src = (raw && typeof raw === "object" ? (raw as { rules?: Record<string, RuleParams> }).rules : undefined) ?? {};
  for (const x of RULES) {
    const p = src[x.id];
    if (!p || typeof p !== "object") continue;
    if (x.params?.months !== undefined && p.months !== undefined) {
      const m = Number(p.months);
      if (!Number.isFinite(m) || m < MONTHS_MIN || m > MONTHS_MAX)
        out.push("“" + x.sentence({ months: x.params.months }).replace(/\d+ months/, "N months") + "” needs a number of months between " + MONTHS_MIN + " and " + MONTHS_MAX + ".");
    }
    if (x.params?.tiers !== undefined && Array.isArray(p.tiers)) {
      if (p.tiers.length === 0) out.push("Choose at least one tier for the rule “No DRP test on record for the chosen tiers”, or it never fires.");
      else if (p.tiers.some((t) => !Number.isInteger(t) || t < 1 || t > 4)) out.push("Tiers run from T1 to T4.");
    }
  }
  return out;
}

interface Resolved { rule: Rule; params: ResolvedParams; enabled: boolean }

function resolve(rules: RulesSettings | null | undefined): Resolved[] {
  const clean = cleanRules(rules);
  return RULES.map((rule) => {
    const s = clean.rules[rule.paramsFrom ?? rule.id] ?? {};
    const params: ResolvedParams = {};
    if (rule.params?.months !== undefined) params.months = s.months ?? rule.params.months;
    if (rule.params?.tiers !== undefined) params.tiers = s.tiers ?? [...rule.params.tiers];
    return { rule, params, enabled: !rule.toggle || s.on !== false };
  });
}

// ------------------------------------------------------------------------------------ evaluate

const RANK: Readonly<Record<Status, number>> = { bad: 3, warn: 2, none: 1, ok: 0 };

/** The worst of some statuses: bad > warn > none > ok. An empty list is 'ok'. */
export function worst(statuses: readonly Status[]): Status {
  let w: Status = "ok";
  for (const s of statuses) if (RANK[s] > RANK[w]) w = s;
  return w;
}

export interface PillarResult {
  status: Status;
  /** The first fired rule at the worst level, in catalogue order; null for ok and none. */
  why: string | null;
  /** Its sentence, or the no-data / ok sentence. */
  sentence: string;
  /** Every fired enabled rule, in catalogue order. */
  fired: string[];
}

export interface AppStatus {
  cyber: PillarResult;
  compliance: PillarResult;
  continuity: PillarResult;
  platform: PillarResult;
  worst: Status;
  /** bad pillars * 100 + warn pillars * 10: the 'worst first' sort key. */
  sort: number;
}

/** Whether nothing is known for the pillar, so that no rule firing means 'none' rather than 'ok'. */
export function noData(pillar: Pillar, a: AppRecord): boolean {
  switch (pillar) {
    case "cyber": return !has(a.lastPentest);
    case "compliance": return !hasClassification(a);
    case "continuity": return a.rto === null && a.mtd === null && !has(a.lastDrpTest);
    case "platform": return !has(a.typology) && !has(a.hosting);
  }
}

const NO_DATA_SENTENCE: Record<Pillar, string> = {
  cyber: "No pentest on record",
  compliance: "Not classified",
  continuity: "No DRP data",
  platform: "Typology not set",
};

const CLEAN_FINDINGS = new Set(["", "none", "nil", "no", "no findings", "no finding", "clean", "0", "n/a", "-"]);

function okSentence(pillar: Pillar, a: AppRecord): string {
  switch (pillar) {
    case "cyber": {
      const t = (a.findingsText ?? "").trim();
      if (CLEAN_FINDINGS.has(t.toLowerCase())) return "Pentest clean";
      return "Pentest done, " + (t.length > 80 ? t.slice(0, 80).trim() + "..." : t);
    }
    case "compliance": return "Classification validated";
    case "continuity": return a.drpResult === "passed" ? "DRP tested, passed" : "DRP data on record";
    case "platform": return "Complete";
  }
}

function pillarResult(pillar: Pillar, a: AppRecord, rs: readonly Resolved[], today: string): PillarResult {
  const fired: Resolved[] = [];
  for (const x of rs) if (x.rule.pillar === pillar && x.enabled && x.rule.test(a, x.params, today)) fired.push(x);
  if (fired.length) {
    const level: RuleLevel = fired.some((x) => x.rule.level === "bad") ? "bad" : "warn";
    const first = fired.find((x) => x.rule.level === level)!;
    return { status: level, why: first.rule.id, sentence: first.rule.sentence(first.params), fired: fired.map((x) => x.rule.id) };
  }
  if (noData(pillar, a)) return { status: "none", why: null, sentence: NO_DATA_SENTENCE[pillar], fired: [] };
  return { status: "ok", why: null, sentence: okSentence(pillar, a), fired: [] };
}

function evalResolved(a: AppRecord, rs: readonly Resolved[], today: string): AppStatus {
  const cyber = pillarResult("cyber", a, rs, today);
  const compliance = pillarResult("compliance", a, rs, today);
  const continuity = pillarResult("continuity", a, rs, today);
  const platform = pillarResult("platform", a, rs, today);
  const all = [cyber, compliance, continuity, platform];
  return {
    cyber, compliance, continuity, platform,
    worst: worst(all.map((x) => x.status)),
    sort: all.filter((x) => x.status === "bad").length * 100 + all.filter((x) => x.status === "warn").length * 10,
  };
}

/** The four pillar statuses of one application. */
export function evaluate(app: AppRecord, rules: RulesSettings, today: string): AppStatus {
  return evalResolved(app, resolve(rules), today);
}

/** evaluate over a whole register, resolving the rule parameters once. */
export function evaluateAll(apps: readonly AppRecord[], rules: RulesSettings, today: string): AppStatus[] {
  const rs = resolve(rules);
  return apps.map((a) => evalResolved(a, rs, today));
}

/**
 * How many applications each rule's test is true for, ignoring the on/off switches (the Settings
 * page shows what a rule would do before it is switched on). Uses the draft params it is given.
 */
export function ruleCounts(apps: readonly AppRecord[], rules: RulesSettings, today: string): Record<string, number> {
  const rs = resolve(rules);
  const out: Record<string, number> = {};
  for (const x of rs) {
    let n = 0;
    for (const a of apps) if (x.rule.test(a, x.params, today)) n++;
    out[x.rule.id] = n;
  }
  return out;
}

export interface Census {
  version: number;
  total: number;
  pillars: Record<Pillar, Record<Status, number>>;
  worst: Record<Status, number>;
  /** Applications per tier; 'none' for an unknown tier. */
  tiers: Record<"1" | "2" | "3" | "4" | "none", number>;
}

const zero = (): Record<Status, number> => ({ bad: 0, warn: 0, ok: 0, none: 0 });

/** Pillar by status counts and per-tier counts: what a snapshot or an overview needs. */
export function census(apps: readonly AppRecord[], rules: RulesSettings, today: string): Census {
  const rs = resolve(rules);
  const out: Census = {
    version: RULES_VERSION, total: apps.length,
    pillars: { cyber: zero(), compliance: zero(), continuity: zero(), platform: zero() },
    worst: zero(), tiers: { "1": 0, "2": 0, "3": 0, "4": 0, none: 0 },
  };
  for (const a of apps) {
    const s = evalResolved(a, rs, today);
    for (const p of PILLARS) out.pillars[p][s[p].status]++;
    out.worst[s.worst]++;
    out.tiers[a.tier === null ? "none" : (String(a.tier) as "1" | "2" | "3" | "4")]++;
  }
  return out;
}
