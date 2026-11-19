// Extracted from the author's production Apps Script apps; adapted.
// A word-sized inline SVG trend. A reading that is null, empty, boolean or not finite is a GAP: it
// keeps its slot and breaks the line, and is never plotted as zero.
import { attrs, html, styleDecls } from "@gas-kit/client/html.js";
import { fmtNum, r2 } from "./chartModel.js";

const VARIANTS = ["line", "area", "bar"];
const PAD = 2;

/**
 * A reading, or null for a gap. Refused by type before any cast: Number(null), Number("") and
 * Number(false) are all 0 and finite, which would draw a missing reading as a crash to zero.
 * @param {unknown} v
 * @returns {number|null}
 */
function reading(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The size, clamped to a sane positive integer.
 * @param {unknown} v
 * @param {number} d
 * @returns {number}
 */
function size(v, d) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d;
  return Math.min(1000, Math.max(8, n));
}

/**
 * A chart token name (chart-1 to chart-6 or another token); anything else falls back.
 * @param {unknown} t
 * @returns {string}
 */
function toneOf(t) {
  return typeof t === "string" && /^[a-z][a-z0-9-]*$/.test(t) ? t : "chart-1";
}

/**
 * The sentence a screen reader gets instead of the picture.
 * @param {string} name
 * @param {number[]} m measured readings
 * @param {number} gaps
 * @returns {string}
 */
function labelOf(name, m, gaps) {
  const lead = name ? name + ": " : "";
  if (!m.length) return lead + "not measured";
  if (m.length === 1) return lead + "one reading, " + fmtNum(m[0]);
  return lead + "starts at " + fmtNum(m[0]) + ", ends at " + fmtNum(m[m.length - 1]) + ", low " + fmtNum(Math.min(...m)) + ", high " + fmtNum(Math.max(...m)) + ", " + m.length + " readings" + (gaps ? ", " + gaps + " not measured" : "");
}

/**
 * @component sparkline
 * @title Sparkline
 * @category Charts
 * @summary A word-sized inline trend: a line, an area or bars, with gaps kept as gaps.
 * @param {{values: Array<unknown>, label?: string, width?: number, height?: number, variant?: "line"|"area"|"bar", tone?: string, k?: string}} p
 * `values` has one slot per reading, in order; a null, empty, boolean or non-finite slot is a gap that breaks the line (or leaves no bar) and is never drawn as zero. A flat series draws mid-height. `label` names the series; the accessible label always adds the first, last, low and high readings. `width` and `height` are in pixels (default 96 by 24). `tone` is a chart token name (default chart-1). `k` is the data-k hook.
 * @emits none
 * @states default, area, bar, gaps, flat, empty
 * @a11y The svg is an image (role="img") whose aria-label states the first, last, low and high readings and how many were measured and missing, so the figures are never only in the picture. Nothing animates. With no readings it says "not measured" and draws only a dashed baseline, so the empty case is not colour alone.
 * @example default: sparkline({ values: [12, 14, 13, 18, 21, 19, 25], label: "Open items" })
 * @example area: sparkline({ values: [12, 14, 13, 18, 21, 19, 25], variant: "area", tone: "chart-2", label: "Open items" })
 * @example bar: sparkline({ values: [3, 5, 2, 8, 6], variant: "bar", label: "Weekly closed" })
 * @example gaps: sparkline({ values: [12, null, 9, 7, "", 15], label: "Scan time" })
 * @example flat: sparkline({ values: [41, 41, 41, 41], label: "Half-life" })
 * @example empty: sparkline({ values: [], label: "Scan time" })
 */
export function sparkline(p) {
  const q = p || /** @type {any} */ ({});
  const slots = Array.isArray(q.values) ? q.values : [];
  const w = size(q.width, 96);
  const h = size(q.height, 24);
  const variant = VARIANTS.indexOf(String(q.variant)) >= 0 ? q.variant : "line";
  const vals = slots.map(reading);
  const m = /** @type {number[]} */ (vals.filter((v) => v !== null));
  const gaps = vals.length - m.length;
  const innerW = w - PAD * 2;
  const innerH = h - PAD * 2;
  const min = m.length ? Math.min(...m) : 0;
  const span = m.length ? Math.max(...m) - min : 0;
  // A flat series is a real reading: it sits mid-height rather than dividing by a zero span.
  const y = (/** @type {number} */ v) => r2(span === 0 ? PAD + innerH / 2 : PAD + innerH - ((v - min) / span) * innerH);
  const x = (/** @type {number} */ i) => r2(vals.length < 2 ? PAD + innerW / 2 : PAD + (i / (vals.length - 1)) * innerW);
  const label = labelOf(typeof q.label === "string" ? q.label : "", m, gaps);
  // The drawn width from the first measured slot to the last. Under 4px a trend has no direction
  // (a lone reading, or a few readings crowded at one edge), so nothing is drawn.
  const first = vals.findIndex((v) => v !== null);
  const last = vals.length - 1 - [...vals].reverse().findIndex((v) => v !== null);
  const spanPx = m.length ? Math.abs(x(last) - x(first)) : 0;
  const narrow = m.length > 0 && spanPx < 4;
  const cls = "gk-sparkline is-" + variant + (m.length === 0 ? " is-empty" : "") + (narrow ? " is-narrow" : "");
  const style = styleDecls({ color: "var(--" + toneOf(q.tone) + ")" });
  const k = q.k ? attrs({ "data-k": q.k }) : "";
  let body;
  if (!m.length) {
    body = html`<line class="gk-sparkline__base" x1="${PAD}" y1="${h / 2}" x2="${w - PAD}" y2="${h / 2}"></line>`;
  } else if (narrow) {
    body = "";
  } else if (variant === "bar") {
    // Bars are compared by length, so the scale holds zero and the baseline is y(0).
    const lo = Math.min(0, min);
    const hi = Math.max(0, min + span);
    const yb = (/** @type {number} */ v) => r2(hi === lo ? PAD + innerH : PAD + innerH - ((v - lo) / (hi - lo)) * innerH);
    const bw = Math.max(1, Math.min(r2((innerW / vals.length) * 0.7), 6));
    const y0 = yb(0);
    body = html`${vals.map((v, i) => {
      if (v === null || v === 0) return "";
      const t = yb(v);
      const top = v > 0 ? Math.min(t, y0 - 1) : y0;
      const bh = v > 0 ? r2(y0 - top) : Math.max(1, r2(t - y0));
      return html`<rect class="gk-sparkline__bar" x="${r2(PAD + ((i + 0.5) / vals.length) * innerW - bw / 2)}" y="${top}" width="${bw}" height="${bh}"></rect>`;
    })}`;
  } else {
    // One run per stretch between gaps; a lone reading is drawn as a dot so it is not lost.
    /** @type {Array<Array<[number, number]>>} */
    const runs = [];
    let cur = /** @type {Array<[number, number]>|null} */ (null);
    vals.forEach((v, i) => {
      if (v === null) { cur = null; return; }
      if (!cur) { cur = []; runs.push(cur); }
      cur.push([x(i), y(v)]);
    });
    const base = r2(PAD + innerH);
    body = html`${runs.map((run) => {
      if (run.length === 1) return html`<circle class="gk-sparkline__dot" cx="${run[0][0]}" cy="${run[0][1]}" r="1.5"></circle>`;
      const d = run.map((pt, i) => (i ? "L" : "M") + pt[0] + "," + pt[1]).join(" ");
      const fill = variant === "area" ? html`<path class="gk-sparkline__area" d="${d + " L" + run[run.length - 1][0] + "," + base + " L" + run[0][0] + "," + base + " Z"}"></path>` : "";
      return html`${fill}<path class="gk-sparkline__line" d="${d}" vector-effect="non-scaling-stroke"></path>`;
    })}`;
  }
  return html`<svg class="${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" style="${style}" ${k}>${body}</svg>`;
}
