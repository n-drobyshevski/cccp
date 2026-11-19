// DOM-free geometry for the native SVG charts: scales, ticks, stacking, curves, arcs.
// Curve maths follow the public d3-shape algorithms (natural cubic spline, monotone X, step).
// Angles are degrees, 0 at the top, clockwise. Every export is an @internal helper.
// Dates are yyyy-MM-dd strings read by their digits into UTC day numbers, never by new Date(string).

/**
 * Round to two decimals for compact path data.
 * @internal
 * @param {number} v
 * @returns {number}
 */
export function r2(v) {
  const n = Math.round(v * 100) / 100;
  return Object.is(n, -0) ? 0 : n;
}

/**
 * Format a number for tips, labels and tables (en-US grouping, up to two decimals).
 * @internal
 * @param {unknown} v
 * @returns {string}
 */
export function fmtNum(v) {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * A finite number, or the fallback.
 * @internal
 * @param {unknown} v
 * @param {number} [d]
 * @returns {number}
 */
export function num(v, d = 0) {
  if (v == null || v === "" || typeof v === "boolean") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * Nice ticks covering [min, max]: a step of 1, 2, 2.5, 5 or 10 times a power of ten.
 * @internal
 * @param {number} min
 * @param {number} max
 * @param {number} [count] wanted number of intervals
 * @returns {{ticks: number[], min: number, max: number, step: number}}
 */
export function niceTicks(min, max, count = 4) {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { if (lo === 0) hi = 1; else if (lo > 0) lo = 0; else hi = 0; }
  const raw = (hi - lo) / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a, i = 0; v <= b + step / 2 && i < 200; v += step, i++) ticks.push(r2(Math.round(v / step * 1e6) / 1e6 * step));
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1], step };
}

/**
 * A linear scale; a flat domain maps to the range start.
 * @internal
 * @param {number} d0
 * @param {number} d1
 * @param {number} r0
 * @param {number} r1
 * @returns {(v: number) => number}
 */
export function linearScale(d0, d1, r0, r1) {
  const span = d1 - d0;
  return (v) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

/**
 * A band scale for n categories across [r0, r1]. `padding` is the share of each step left empty.
 * @internal
 * @param {number} n
 * @param {number} r0
 * @param {number} r1
 * @param {number} [padding]
 * @returns {{start: (i: number) => number, center: (i: number) => number, bandwidth: number, step: number}}
 */
export function bandScale(n, r0, r1, padding = 0.2) {
  const count = Math.max(1, n);
  const step = (r1 - r0) / count;
  const bandwidth = step * (1 - Math.min(0.9, Math.max(0, padding)));
  const off = (step - bandwidth) / 2;
  return { start: (i) => r0 + step * i + off, center: (i) => r0 + step * i + step / 2, bandwidth, step };
}

/**
 * A point scale: n points from r0 to r1 inclusive (one point sits in the middle).
 * @internal
 * @param {number} n
 * @param {number} r0
 * @param {number} r1
 * @returns {(i: number) => number}
 */
export function pointScale(n, r0, r1) {
  return (i) => (n <= 1 ? (r0 + r1) / 2 : r0 + ((r1 - r0) * i) / (n - 1));
}

/**
 * Stack series over rows. Offset "none" stacks positives up and negatives down; "expand"
 * normalises every row to a total of 1.
 * @internal
 * @param {Array<Record<string, unknown>>} rows
 * @param {string[]} keys
 * @param {"none"|"expand"} [offset]
 * @returns {{layers: Array<{key: string, points: Array<{y0: number, y1: number, v: number}>}>, min: number, max: number}}
 */
export function stackSeries(rows, keys, offset = "none") {
  let min = 0;
  let max = 0;
  const layers = keys.map((key) => ({ key, points: /** @type {Array<{y0: number, y1: number, v: number}>} */ ([]) }));
  rows.forEach((row) => {
    const vals = keys.map((k) => num(row && row[k]));
    const total = vals.reduce((a, v) => a + Math.abs(v), 0);
    let pos = 0;
    let neg = 0;
    vals.forEach((v, i) => {
      const s = offset === "expand" ? (total ? v / total : 0) : v;
      let y0;
      let y1;
      if (s >= 0) { y0 = pos; pos += s; y1 = pos; } else { y0 = neg; neg += s; y1 = neg; }
      layers[i].points.push({ y0, y1, v });
      min = Math.min(min, y0, y1);
      max = Math.max(max, y0, y1);
    });
  });
  return { layers, min, max };
}

/** @typedef {[number, number]} Pt */

/**
 * @param {Pt[]} p
 * @returns {string}
 */
function linear(p) {
  return p.map((q, i) => (i ? "L" : "M") + r2(q[0]) + " " + r2(q[1])).join("");
}

/**
 * A step line: the change at the midpoint, or with `after` at the next point (the value holds).
 * @param {Pt[]} p
 * @param {boolean} [after]
 * @returns {string}
 */
function step(p, after) {
  let d = "";
  p.forEach((q, i) => {
    if (!i) { d += "M" + r2(q[0]) + " " + r2(q[1]); return; }
    const xm = after ? q[0] : (p[i - 1][0] + q[0]) / 2;
    d += "L" + r2(xm) + " " + r2(p[i - 1][1]) + "L" + r2(xm) + " " + r2(q[1]) + (after ? "" : "L" + r2(q[0]) + " " + r2(q[1]));
  });
  return d;
}

/**
 * Natural cubic spline control points for one coordinate.
 * @param {number[]} x
 * @returns {[number[], number[]]}
 */
function controlPoints(x) {
  const n = x.length - 1;
  const a = [];
  const b = [];
  const r = [];
  a[0] = 0; b[0] = 2; r[0] = x[0] + 2 * x[1];
  for (let i = 1; i < n - 1; i++) { a[i] = 1; b[i] = 4; r[i] = 4 * x[i] + 2 * x[i + 1]; }
  a[n - 1] = 2; b[n - 1] = 7; r[n - 1] = 8 * x[n - 1] + x[n];
  for (let i = 1; i < n; i++) { const m = a[i] / b[i - 1]; b[i] -= m; r[i] -= m * r[i - 1]; }
  a[n - 1] = r[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) a[i] = (r[i] - a[i + 1]) / b[i];
  b[n - 1] = (x[n] + a[n - 1]) / 2;
  for (let i = 0; i < n - 1; i++) b[i] = 2 * x[i + 1] - a[i + 1];
  return [a, b];
}

/**
 * @param {Pt[]} p
 * @returns {string}
 */
function natural(p) {
  if (p.length < 3) return linear(p);
  const [ax, bx] = controlPoints(p.map((q) => q[0]));
  const [ay, by] = controlPoints(p.map((q) => q[1]));
  let d = "M" + r2(p[0][0]) + " " + r2(p[0][1]);
  for (let i = 0; i < p.length - 1; i++) {
    d += "C" + r2(ax[i]) + " " + r2(ay[i]) + " " + r2(bx[i]) + " " + r2(by[i]) + " " + r2(p[i + 1][0]) + " " + r2(p[i + 1][1]);
  }
  return d;
}

/**
 * @param {number} v
 * @returns {number}
 */
const sign = (v) => (v < 0 ? -1 : 1);

/**
 * Monotone cubic through points sorted by x (no overshoot between samples).
 * @param {Pt[]} p
 * @returns {string}
 */
function monotone(p) {
  const n = p.length;
  if (n < 3) return linear(p);
  const h = [];
  const s = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = p[i + 1][0] - p[i][0];
    s[i] = h[i] ? (p[i + 1][1] - p[i][1]) / h[i] : 0;
  }
  const t = [];
  for (let i = 1; i < n - 1; i++) {
    const pp = h[i - 1] + h[i] ? (s[i - 1] * h[i] + s[i] * h[i - 1]) / (h[i - 1] + h[i]) : 0;
    t[i] = (sign(s[i - 1]) + sign(s[i])) * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(pp)) || 0;
  }
  t[0] = h[0] ? (3 * s[0] - t[1]) / 2 : t[1];
  t[n - 1] = h[n - 2] ? (3 * s[n - 2] - t[n - 2]) / 2 : t[n - 2];
  let d = "M" + r2(p[0][0]) + " " + r2(p[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const dx = h[i] / 3;
    d += "C" + r2(p[i][0] + dx) + " " + r2(p[i][1] + dx * t[i]) + " " + r2(p[i + 1][0] - dx) + " " + r2(p[i + 1][1] - dx * t[i + 1]) + " " + r2(p[i + 1][0]) + " " + r2(p[i + 1][1]);
  }
  return d;
}

/**
 * Path data through points for a curve: "linear", "natural", "monotone", "step" (the change at
 * the midpoint) or "stepAfter" (each value holds until the next point, as a survival curve does).
 * @internal
 * @param {Pt[]} pts
 * @param {string} [curve]
 * @returns {string}
 */
export function curvePath(pts, curve = "natural") {
  const p = pts.filter((q) => q && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (!p.length) return "";
  if (p.length === 1) return "M" + r2(p[0][0]) + " " + r2(p[0][1]);
  return curve === "step" ? step(p) : curve === "stepAfter" ? step(p, true) : curve === "monotone" ? monotone(p) : curve === "linear" ? linear(p) : natural(p);
}

/**
 * A closed area between a top line and a base line (both left to right, same curve).
 * @internal
 * @param {Pt[]} top
 * @param {Pt[]} base
 * @param {string} [curve]
 * @returns {string}
 */
export function areaPath(top, base, curve = "natural") {
  if (!top.length || top.length !== base.length) return "";
  const fwd = curvePath(top, curve);
  const back = curvePath(base.slice().reverse(), curve).replace(/^M/, "L");
  return fwd + back + "Z";
}

/**
 * A rectangle path with a separate radius per corner (clamped to half the shorter side).
 * @internal
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{tl?: number, tr?: number, br?: number, bl?: number}} [r]
 * @returns {string}
 */
export function roundRectPath(x, y, w, h, r = {}) {
  const m = Math.max(0, Math.min(w, h) / 2);
  const c = (/** @type {number|undefined} */ v) => Math.min(m, Math.max(0, v || 0));
  const tl = c(r.tl);
  const tr = c(r.tr);
  const br = c(r.br);
  const bl = c(r.bl);
  const arc = (/** @type {number} */ rad, /** @type {number} */ dx, /** @type {number} */ dy) => (rad ? "A" + r2(rad) + " " + r2(rad) + " 0 0 1 " + r2(dx) + " " + r2(dy) : "");
  return "M" + r2(x + tl) + " " + r2(y)
    + "H" + r2(x + w - tr) + arc(tr, x + w, y + tr)
    + "V" + r2(y + h - br) + arc(br, x + w - br, y + h)
    + "H" + r2(x + bl) + arc(bl, x, y + h - bl)
    + "V" + r2(y + tl) + arc(tl, x + tl, y) + "Z";
}

/**
 * A point on a circle.
 * @internal
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} deg 0 at the top, clockwise
 * @returns {Pt}
 */
export function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/**
 * A filled sector (r0 = 0) or ring segment between two radii and two angles.
 * @internal
 * @param {number} cx
 * @param {number} cy
 * @param {number} r0
 * @param {number} r1
 * @param {number} a0
 * @param {number} a1
 * @returns {string}
 */
export function arcPath(cx, cy, r0, r1, a0, a1) {
  const sweep = Math.min(359.99, Math.max(0, a1 - a0));
  if (sweep <= 0 || r1 <= 0) return "";
  const e = a0 + sweep;
  const large = sweep > 180 ? 1 : 0;
  const o0 = polar(cx, cy, r1, a0);
  const o1 = polar(cx, cy, r1, e);
  let d = "M" + r2(o0[0]) + " " + r2(o0[1]) + "A" + r2(r1) + " " + r2(r1) + " 0 " + large + " 1 " + r2(o1[0]) + " " + r2(o1[1]);
  if (r0 > 0) {
    const i1 = polar(cx, cy, r0, e);
    const i0 = polar(cx, cy, r0, a0);
    d += "L" + r2(i1[0]) + " " + r2(i1[1]) + "A" + r2(r0) + " " + r2(r0) + " 0 " + large + " 0 " + r2(i0[0]) + " " + r2(i0[1]) + "Z";
  } else {
    d += "L" + r2(cx) + " " + r2(cy) + "Z";
  }
  return d;
}

/**
 * An open arc on one radius, drawn with a stroke (radial rings). A full turn becomes two halves.
 * @internal
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} a0
 * @param {number} a1
 * @returns {string}
 */
export function ringPath(cx, cy, r, a0, a1) {
  const sweep = Math.max(0, a1 - a0);
  if (sweep <= 0 || r <= 0) return "";
  const part = (/** @type {number} */ s, /** @type {number} */ e) => {
    const p0 = polar(cx, cy, r, s);
    const p1 = polar(cx, cy, r, e);
    return "M" + r2(p0[0]) + " " + r2(p0[1]) + "A" + r2(r) + " " + r2(r) + " 0 " + (e - s > 180 ? 1 : 0) + " 1 " + r2(p1[0]) + " " + r2(p1[1]);
  };
  if (sweep >= 359.99) return part(a0, a0 + 180) + part(a0 + 180, a0 + 359.99);
  return part(a0, a0 + sweep);
}

/**
 * Points of a radar polygon: one per axis, evenly spaced from the top.
 * @internal
 * @param {number[]} values
 * @param {number} max value mapped to the outer radius
 * @param {number} cx
 * @param {number} cy
 * @param {number} r outer radius
 * @returns {Pt[]}
 */
export function radarPoints(values, max, cx, cy, r) {
  const n = values.length;
  return values.map((v, i) => polar(cx, cy, max > 0 ? (Math.max(0, v) / max) * r : 0, (360 * i) / n));
}

/**
 * A closed polygon path.
 * @internal
 * @param {Pt[]} pts
 * @returns {string}
 */
export function polygonPath(pts) {
  return pts.length ? linear(pts) + "Z" : "";
}

/**
 * Start and end angles for slices sized by value; non-positive values get an empty slice.
 * @internal
 * @param {number[]} values
 * @param {number} [start]
 * @param {number} [end]
 * @returns {Array<{a0: number, a1: number, frac: number}>}
 */
export function sliceAngles(values, start = 0, end = 360) {
  const vs = values.map((v) => Math.max(0, num(v)));
  const total = vs.reduce((a, v) => a + v, 0);
  let a = start;
  return vs.map((v) => {
    const frac = total ? v / total : 0;
    const a0 = a;
    a += frac * (end - start);
    return { a0, a1: a, frac };
  });
}

/**
 * A CSS colour reference for a series colour: "chart-1".."chart-6" or another token name.
 * Anything that is not a plain token name falls back to the palette slot for the index.
 * @internal
 * @param {unknown} color
 * @param {number} index
 * @returns {string}
 */
export function colorVar(color, index) {
  const c = typeof color === "string" ? color.replace(/^--/, "") : "";
  if (/^[a-z][a-z0-9-]*$/.test(c)) return "var(--" + c + ")";
  return "var(--chart-" + ((((index % 6) + 6) % 6) + 1) + ")";
}

/**
 * The UTC day number (days since 1970-01-01) of a yyyy-MM-dd string, or null when it is not a
 * real calendar date (a day that rolls over, such as 2025-02-30, reads back differently). The
 * digits go to Date.UTC; the string never reaches new Date.
 * @internal
 * @param {unknown} s
 * @returns {number|null}
 */
export function ymdDay(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s));
  const d = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : 0;
  return m && dayText(d) === s ? d : null;
}

/**
 * A UTC day number as a yyyy-MM-dd string (a Date built from a number, read in UTC).
 * @internal
 * @param {number} day
 * @returns {string}
 */
export function dayText(day) {
  return new Date(Math.round(day) * 864e5).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A UTC day number as "7 Mar 2025", or without the year.
 * @internal
 * @param {number} day
 * @param {boolean} [noYear]
 * @returns {string}
 */
export function dayLabel(day, noYear) {
  const t = dayText(day);
  return +t.slice(8) + " " + MONTHS[+t.slice(5, 7) - 1] + (noYear ? "" : " " + t.slice(0, 4));
}

/**
 * A UTC day number in a named date format: "dd-mmm-yyyy" ("07-mar-2026"), "yyyy-mm-dd", or
 * anything else as dayLabel ("7 Mar 2026", the "d mmm" default).
 * @internal
 * @param {number} day
 * @param {unknown} [f]
 * @returns {string}
 */
export function dayFmt(day, f) {
  const t = dayText(day);
  return f === "yyyy-mm-dd" ? t : f === "dd-mmm-yyyy" ? t.slice(8) + "-" + MONTHS[+t.slice(5, 7) - 1].toLowerCase() + "-" + t.slice(0, 4) : dayLabel(day);
}

/** Width of one character of 12px tick text in drawing units: a generous average, so the overlap check errs towards fewer labels. */
export const CHAR_PX = 7;

/**
 * Ticks inside [lo, hi] at a nice step (1, 2, 2.5, 5 or 10 times a power of ten) for about
 * `count` intervals. Unlike niceTicks the domain is kept as given (an axis clipped to [0, 52]
 * ends at 52), so the ends need not be ticks.
 * @internal
 * @param {number} lo
 * @param {number} hi
 * @param {number} count
 * @returns {number[]}
 */
export function ticksIn(lo, hi, count) {
  if (!(hi > lo)) return Number.isFinite(lo) ? [r2(lo)] : [];
  return stepTicks(lo, hi, niceTicks(0, (hi - lo) / Math.max(1, count), 1).step);
}

/**
 * The multiples of `st` inside [lo, hi], at most 200.
 * @internal
 * @param {number} lo
 * @param {number} hi
 * @param {number} st a positive step
 * @returns {number[]}
 */
export function stepTicks(lo, hi, st) {
  const out = [];
  for (let i = Math.ceil(lo / st - 1e-9); i * st <= hi + st * 1e-9 && out.length < 200; i++) out.push(r2(Math.round(i * st * 1e6) / 1e6));
  return out;
}

/**
 * Tick labels on one row, anchored so the end labels stay inside [0, vw]: the middle by default,
 * the start or end at an edge. Null when two labels would overlap (8 units apart at least).
 * @internal
 * @param {Array<{x: number, text: string}>} items in left to right order
 * @param {number} vw
 * @returns {Array<{x: number, text: string, anchor: string}>|null}
 */
export function layoutLabels(items, vw) {
  let right = -Infinity;
  const out = [];
  for (const it of items) {
    const w = String(it.text).length * CHAR_PX;
    let x0 = it.x - w / 2;
    const anchor = x0 < 0 ? "start" : it.x + w / 2 > vw ? "end" : "middle";
    if (anchor !== "middle") x0 = anchor === "start" ? it.x : it.x - w;
    if (x0 < right + 8) return null;
    right = x0 + w;
    out.push({ x: it.x, text: it.text, anchor });
  }
  return out;
}

/**
 * Numeric axis ticks whose 12px labels fit: the most ticks, about one per 56 units, with no two
 * labels overlapping. One label at the domain start when nothing else fits.
 * @internal
 * @param {number} lo
 * @param {number} hi
 * @param {(v: number) => number} x scale
 * @param {number} iw plot width
 * @param {number} vw drawing width
 * @param {(v: number) => string} fmt
 * @returns {Array<{x: number, text: string, anchor: string}>}
 */
export function fitLinearTicks(lo, hi, x, iw, vw, fmt) {
  for (let n = Math.max(1, Math.floor(iw / 56)); n >= 1; n--) {
    const laid = layoutLabels(ticksIn(lo, hi, n).map((t) => ({ x: x(t), text: fmt(t) })), vw);
    if (laid && laid.length) return laid;
  }
  return layoutLabels([{ x: x(lo), text: fmt(lo) }], vw) || [];
}

/**
 * Time axis ticks over UTC day numbers whose 12px labels fit: the finest calendar step (1, 2, 7
 * or 14 days with weeks on Mondays; 1, 2, 3 or 6 months; 1 to 100 years) with no two labels
 * overlapping. Day ticks read "7 Mar", month ticks "Mar", year ticks "2025"; the first tick and
 * the first tick of a new year also name the year. With `fmt` every tick reads fmt(day).
 * @internal
 * @param {number} d0
 * @param {number} d1
 * @param {(v: number) => number} x scale
 * @param {number} iw plot width
 * @param {number} vw drawing width
 * @param {(day: number) => string} [fmt]
 * @returns {Array<{x: number, text: string, anchor: string}>}
 */
export function timeTicks(d0, d1, x, iw, vw, fmt) {
  // A positive step counts days; a negative one months (12 and more: whole years, in January).
  for (const n of [1, 2, 7, 14, -1, -2, -3, -6, -12, -24, -60, -120, -240, -600, -1200]) {
    if ((d1 - d0) / (n > 0 ? n : -n * 30.4) > iw / 24) continue;
    const items = [];
    let prev = 0;
    for (let d = d0; d <= d1; d++) {
      const t = dayText(d);
      const y = +t.slice(0, 4);
      const mo = +t.slice(5, 7);
      // Day 4 (1970-01-05) is a Monday, so week ticks fall on Mondays.
      if (n > 0 ? (d - (n >= 7 ? 4 : 0)) % n : t.slice(8) !== "01" || (y * 12 + mo - 1) % n) continue;
      const base = n > 0 ? dayLabel(d, true) : MONTHS[mo - 1];
      items.push({ x: x(d), text: fmt ? fmt(d) : n <= -12 ? String(y) : prev === y ? base : base + " " + y });
      prev = y;
    }
    const laid = items.length ? layoutLabels(items, vw) : null;
    if (laid) return laid;
  }
  return [];
}

/**
 * The value of a line at x, as the drawn curve gives it: the point's own value at a data x (the
 * last one when several share it), the left value for "stepAfter", the nearer side of the
 * midpoint for "step", else the straight line between the neighbours. Null outside the points.
 * @internal
 * @param {Pt[]} pts sorted by x
 * @param {number} x
 * @param {string} [curve]
 * @returns {number|null}
 */
export function valueAt(pts, x, curve) {
  const p = pts.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
  const n = p.length;
  if (!n || !(x >= p[0][0] && x <= p[n - 1][0])) return null;
  let i = 0;
  while (i + 1 < n && p[i + 1][0] <= x) i++;
  const a = p[i];
  const b = p[i + 1];
  if (a[0] === x || !b || curve === "stepAfter") return a[1];
  if (curve === "step") return x < (a[0] + b[0]) / 2 ? a[1] : b[1];
  return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
}

/** Marker shapes a chart draws, as path data around (0, 0) about 10 units across; anything else is a circle. */
export const MARK_PATHS = {
  circle: "M-5 0A5 5 0 1 0 5 0A5 5 0 1 0 -5 0Z",
  triangle: "M0 -6.25L6.25 4.7L-6.25 4.7Z",
  square: "M-4.5 -4.5H4.5V4.5H-4.5Z",
  diamond: "M0 -6.5L6.5 0L0 6.5L-6.5 0Z",
};

/**
 * Direct labels for points, placed without a solver: each label tries the right, then the left of
 * its point, then the same 14, 28 and 42 units up and down (joined to the point by a leader
 * line), and takes the first place inside the bounds that overlaps no point and no label placed
 * before it (so the first point gets the best place). With no free place it takes the first one
 * inside the bounds. `others` are points that take no label but must not be covered by one.
 * @internal
 * @param {Array<{x: number, y: number, r: number, text: string}>} pts
 * @param {{l: number, t: number, r: number, b: number}} bounds
 * @param {Array<{x: number, y: number, r: number}>} [others]
 * @returns {Array<{x: number, y: number, anchor: string, leader: boolean}>} one per point, y the text's centre
 */
export function placeLabels(pts, bounds, others = []) {
  const taken = pts.concat(/** @type {any} */ (others)).map((p) => [p.x - p.r - 1, p.y - p.r - 1, p.x + p.r + 1, p.y + p.r + 1]);
  return pts.map((p) => {
    const w = String(p.text).length * CHAR_PX;
    const c = [];
    for (const dy of [0, -14, 14, -28, 28, -42, 42]) {
      for (const side of [1, -1]) {
        const x = p.x + side * (p.r + (dy ? 10 : 4));
        const x0 = side > 0 ? x : x - w;
        c.push({ x, y: p.y + dy, anchor: side > 0 ? "start" : "end", leader: !!dy, b: [x0, p.y + dy - 7, x0 + w, p.y + dy + 7] });
      }
    }
    const ok = c.filter((o) => o.b[0] >= bounds.l && o.b[2] <= bounds.r && o.b[1] >= bounds.t && o.b[3] <= bounds.b);
    const pick = ok.find((o) => !taken.some((t) => o.b[0] < t[2] && o.b[2] > t[0] && o.b[1] < t[3] && o.b[3] > t[1])) || ok[0] || c[0];
    taken.push(pick.b);
    return pick;
  });
}
