// Calendar-day arithmetic that never touches the machine's time zone. A "day" is the string
// 'yyyy-MM-dd', already formatted in the Sheet's zone by the server; everything here works on
// UTC day numbers, so the result is the same in any zone (the date suites run under UTC and
// Pacific/Kiritimati to prove it).

const MS_PER_DAY = 86_400_000;
/** One month in days, as the status rules count age. */
export const DAYS_PER_MONTH = 30.4375;

function pad(n: number, w: number): string {
  let s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}

function make(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return pad(y, 4) + "-" + pad(m, 2) + "-" + pad(d, 2);
}

/**
 * Read a day from 'yyyy-MM-dd' (an optional time after it is ignored) or 'dd/MM/yyyy'
 * (also d/M/yyyy). Returns the normalised 'yyyy-MM-dd', or null when it is not a real date.
 */
export function parseDay(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) return make(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return make(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDay(v) === v;
}

/** Days since 1970-01-01 of a valid day, or null. */
export function dayNumber(day: string | null | undefined): number | null {
  const p = parseDay(day ?? null);
  if (!p) return null;
  return Math.round(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, Number(p.slice(8, 10))) / MS_PER_DAY);
}

/** Whole days from a to b (negative when b is earlier). null when either is not a day. */
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = dayNumber(a);
  const y = dayNumber(b);
  return x === null || y === null ? null : y - x;
}

/** Months from a to b at 30.4375 days per month; null when either is not a day. */
export function monthsBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const d = daysBetween(a, b);
  return d === null ? null : d / DAYS_PER_MONTH;
}

export function addDays(day: string, n: number): string | null {
  const x = dayNumber(day);
  if (x === null) return null;
  const t = new Date((x + n) * MS_PER_DAY);
  return pad(t.getUTCFullYear(), 4) + "-" + pad(t.getUTCMonth() + 1, 2) + "-" + pad(t.getUTCDate(), 2);
}

/** 'today', '3 days ago', '5 months ago', '2 years ago', or 'in 4 days' for a future day. '' when unknown. */
export function relativeAge(day: string | null | undefined, today: string): string {
  const d = daysBetween(day, today);
  if (d === null) return "";
  if (d === 0) return "today";
  const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
  if (d < 0) return "in " + plural(-d, "day");
  if (d < 45) return plural(d, "day") + " ago";
  const months = d / DAYS_PER_MONTH;
  if (months < 24) return plural(Math.round(months), "month") + " ago";
  return plural(Math.floor(months / 12), "year") + " ago";
}

/** Compare two days; null sorts as unknown (returns 0 only when both are equal or both unknown). */
export function compareDays(a: string | null | undefined, b: string | null | undefined): number {
  const x = dayNumber(a);
  const y = dayNumber(b);
  if (x === null && y === null) return 0;
  if (x === null) return -1;
  if (y === null) return 1;
  return x - y;
}
