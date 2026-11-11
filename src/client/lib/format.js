// Small text helpers. Dates arrive as yyyy-MM-dd strings already in the Sheet's time zone, so
// they are formatted by splitting the string, never through new Date().
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1125 -> '1,125'. */
export function num(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "";
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function plural(n, one, many) {
  return n === 1 ? one : many || one + "s";
}

/** '3 applications'. */
export function count(n, one, many) {
  return num(n) + " " + plural(n, one, many);
}

export function pct(v) {
  return v == null ? "" : Math.round(v) + "%";
}

/** '2025-03-07' -> '7 Mar 2025'; anything else comes back unchanged. */
export function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? "" : iso));
  if (!m) return iso == null ? "" : String(iso);
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return String(iso);
  return Number(m[3]) + " " + MONTHS[mi] + " " + m[1];
}

/** '2025-03-07T10:15:00.000Z' -> '7 Mar 2025, 10:15 UTC'. */
export function stamp(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso == null ? "" : iso));
  return m ? day(m[1]) + ", " + m[2] + " UTC" : day(iso);
}
