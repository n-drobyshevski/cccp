import { parseDay } from "./dates";
import type { DrpResult, Level } from "./types";

// Cell to typed value. Every function is total: an unreadable value gives null, never a guess.
// A cell that is non-blank but gives null is counted by assemble as "unparseable", so isBlank is
// exported next to the readers.

export type Cell = string | number | boolean | null | undefined;

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Trimmed text, or null for a blank cell. Numbers and booleans become their text. */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return null;
}

const YES = new Set(["yes", "y", "true", "oui", "o", "vrai", "1", "x", "available", "enabled"]);
const NO = new Set(["no", "n", "false", "non", "faux", "0", "unavailable", "disabled"]);

/** yes/no/oui/non and friends, case and accent-insensitive. null when blank or not recognised. */
export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  const t = text(v);
  if (t === null) return null;
  const k = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (YES.has(k)) return true;
  if (NO.has(k)) return false;
  return null;
}

/** A tier 1..4: 2, '2', '2.0', 'T2', 'Tier 2'. Anything else is null. */
export function tier(v: unknown): Level | null {
  let n: number;
  if (typeof v === "number") n = v;
  else {
    const t = text(v);
    if (t === null) return null;
    const m = /^(?:t|tier)?\s*(\d)(?:\.0+)?$/i.exec(t);
    if (!m) return null;
    n = Number(m[1]);
  }
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

const LEVEL_WORDS: Record<string, Level> = { low: 1, medium: 2, moderate: 2, high: 3, critical: 4, "very high": 4 };

/** A CIAT level 1..4: a number, 'Level 3', 'L3', or low/medium/high/critical. */
export function level(v: unknown): Level | null {
  if (typeof v !== "number") {
    const t = text(v);
    if (t === null) return null;
    const k = t.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(LEVEL_WORDS, k)) return LEVEL_WORDS[k]!;
    const m = /^(?:level|lvl|l)?\s*(\d)(?:\.0+)?$/i.exec(t);
    return m ? tier(Number(m[1])) : null;
  }
  return tier(v);
}

const UNIT_HOURS: Record<string, number> = {
  m: 1 / 60, min: 1 / 60, mins: 1 / 60, minute: 1 / 60, minutes: 1 / 60,
  h: 1, hr: 1, hrs: 1, hour: 1, hours: 1,
  d: 24, day: 24, days: 24,
  w: 168, wk: 168, wks: 168, week: 168, weeks: 168,
};

/** A duration in hours: 4, '4', '4h', '4 hours', '90 min', '2 days', '1,5 h'. A bare number is hours. */
export function hours(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const t = text(v);
  if (t === null) return null;
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  const unit = m[2]!.toLowerCase();
  const k = unit === "" ? 1 : Object.prototype.hasOwnProperty.call(UNIT_HOURS, unit) ? UNIT_HOURS[unit] : undefined;
  if (k === undefined) return null;
  return Math.round(n * k * 1e6) / 1e6;
}

/** A day 'yyyy-MM-dd' from yyyy-MM-dd or dd/MM/yyyy text. */
export function day(v: unknown): string | null {
  return parseDay(typeof v === "string" ? v : null);
}

/** passed / failed from the usual words in English and French. */
export function drpResult(v: unknown): DrpResult | null {
  const t = text(v);
  if (t === null) return null;
  const k = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\b(fail|failed|failure|ko|ech\w*|not passed|unsuccessful)\b/.test(k)) return "failed";
  if (/\b(pass|passed|ok|success|successful|reussi\w*|valide\w*)\b/.test(k)) return "passed";
  return null;
}

const NEGATIONS = new Set(["no", "none", "zero", "without", "aucun", "aucune", "sans", "non", "nil"]);

/**
 * How many findings of a kind a findings text states: '2 major findings' gives 2, '1 critical
 * and 3 high' gives 1 critical and 3 high, 'critical: 2' gives 2, a bare 'critical' gives 1 and
 * 'no critical finding' or 'None' gives 0. null text (nothing known) gives null.
 */
export function findingCount(textValue: unknown, word: string): number | null {
  const t = text(textValue);
  if (t === null) return null;
  const s = t.toLowerCase();
  const w = word.toLowerCase();
  const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(0, m.index).trimEnd().split(/\s+/).slice(-2);
    const prev = before[before.length - 1] ?? "";
    const prev2 = before.length > 1 ? before[0]! : "";
    const after = /^\s*[:=(]\s*(\d+)/.exec(s.slice(m.index + w.length));
    const num = (x: string) => (/^\d+$/.test(x) ? Number(x) : /^x?(\d+)x?$/.test(x) ? Number(/(\d+)/.exec(x)![1]) : null);
    let n: number | null = null;
    if (NEGATIONS.has(prev) || (prev === "x" && NEGATIONS.has(prev2))) n = 0;
    else if (num(prev) !== null) n = num(prev);
    else if (prev === "x" && prev2 && num(prev2) !== null) n = num(prev2);
    else if (after) n = Number(after[1]);
    else n = 1;
    total += n ?? 1;
  }
  return total;
}
