// DOM-free geometry for the native SVG charts: scales, ticks, stacking, curves, arcs.
// Curve maths follow the public d3-shape algorithms (natural cubic spline, monotone X, step).
// Angles are degrees, 0 at the top, clockwise. Every export is an @internal helper.

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
 * @param {Pt[]} p
 * @returns {string}
 */
function step(p) {
  let d = "";
  p.forEach((q, i) => {
    if (!i) { d += "M" + r2(q[0]) + " " + r2(q[1]); return; }
    const xm = (p[i - 1][0] + q[0]) / 2;
    d += "L" + r2(xm) + " " + r2(p[i - 1][1]) + "L" + r2(xm) + " " + r2(q[1]) + "L" + r2(q[0]) + " " + r2(q[1]);
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
 * Path data through points for a curve: "linear", "natural", "monotone" or "step".
 * @internal
 * @param {Pt[]} pts
 * @param {string} [curve]
 * @returns {string}
 */
export function curvePath(pts, curve = "natural") {
  const p = pts.filter((q) => q && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (!p.length) return "";
  if (p.length === 1) return "M" + r2(p[0][0]) + " " + r2(p[0][1]);
  return curve === "step" ? step(p) : curve === "monotone" ? monotone(p) : curve === "linear" ? linear(p) : natural(p);
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
