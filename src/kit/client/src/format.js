// Extracted from the author's production Apps Script apps; adapted.
// Text helpers. Dates arrive as yyyy-MM-dd strings already in the source's time zone, so they
// are parsed by splitting the string and counted with Date.UTC arithmetic, never by handing a
// date-only string to the Date constructor (that reads it as UTC midnight, which is the
// previous day west of Greenwich and breaks in other zones).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_MS = 86400000;

/**
 * Parse a yyyy-MM-dd string. Returns null for anything that is not a real calendar date.
 * @param {unknown} s
 * @returns {{ y: number, m: number, d: number } | null}
 */
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? "" : s));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/** Date.UTC maps years 0 to 99 to 1900 to 1999, so build the instant with setUTCFullYear.
 * @param {number} y @param {number} m0 @param {number} d */
function utcMs(y, m0, d) {
  const t = new Date(0);
  t.setUTCFullYear(y, m0, d);
  return t.getTime();
}

/** @param {number} y @param {number} m 1 to 12 */
const daysInMonth = (y, m) => new Date(utcMs(y, m, 0)).getUTCDate();

/** @param {{ y: number, m: number, d: number }} p */
const utcDay = (p) => utcMs(p.y, p.m - 1, p.d) / DAY_MS;

/**
 * Whole days from a to b (positive when b is later). Null when either is not a valid date.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number | null}
 */
export function daysBetween(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return pa && pb ? Math.round(utcDay(pb) - utcDay(pa)) : null;
}

/**
 * 1234 becomes "1,234". Empty for null, empty or non-numeric input.
 * @param {unknown} v
 * @returns {string}
 */
export function fmtCount(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "";
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 41.6 becomes "42%". Empty for null or non-numeric input.
 * @param {unknown} v
 * @returns {string}
 */
export function fmtPct(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "";
  return Math.round(Number(v)) + "%";
}

/**
 * pluralize(2, "item") is "2 items"; pluralize(1, "item") is "1 item"; pass a plural for
 * irregular words: pluralize(2, "entry", "entries").
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 * @returns {string}
 */
export function pluralize(n, one, many) {
  return fmtCount(n) + " " + (n === 1 ? one : many || one + "s");
}

/**
 * Format a yyyy-MM-dd string. Styles: "short" (7 Mar 2025, the default), "long"
 * (7 March 2025), "iso" (unchanged). Anything that is not a valid date comes back as it was
 * (empty for null).
 * @param {unknown} s
 * @param {"short" | "long" | "iso"} [style]
 * @returns {string}
 */
export function fmtYmd(s, style) {
  const p = parseYmd(s);
  if (!p) return s == null ? "" : String(s);
  if (style === "iso") return String(s);
  const names = style === "long" ? MONTHS_LONG : MONTHS;
  return p.d + " " + names[p.m - 1] + " " + p.y;
}

/**
 * An ISO timestamp as "7 Mar 2025, 10:15 UTC". Other input goes through fmtYmd.
 * @param {unknown} iso
 * @returns {string}
 */
export function fmtStamp(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso == null ? "" : iso));
  if (!m) return fmtYmd(iso);
  // Only a stamp in UTC (a trailing Z, or no zone at all) is labelled UTC; any other offset
  // would be a wrong label, so it falls back to the date alone.
  const rest = String(iso).slice(m[0].length);
  return /^(:\d{2}(\.\d+)?)?Z?$/.test(rest) ? fmtYmd(m[1]) + ", " + m[2] + " UTC" : fmtYmd(m[1]);
}
