// A native SVG scatter chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
// Numeric axes share lineChart's scale and ticks (chartModel.js, chartParts.js).
import { cssValue, html } from "@gas-kit/client/html.js";
import { colorVar, fitLinearTicks, linearScale, MARK_PATHS, niceTicks, num, placeLabels, r2 } from "./chartModel.js";
import { domainPair, emptyView, frameView, gridView, legendView, nameOf, plotBox, refLinesView, tableView, valueFmt, xTicks, yScaleFor } from "./chartParts.js";

/**
 * The point classes of a props object, by own key: a label, a shape from MARK_PATHS, solid or hollow, a token colour.
 * @param {unknown} v
 * @returns {Record<string, {label: string, shape: string, hollow: boolean, color: string}>}
 */
function classesOf(v) {
  /** @type {Record<string, {label: string, shape: string, hollow: boolean, color: string}>} */
  const out = Object.create(null);
  if (!v || typeof v !== "object") return out;
  Object.keys(v).forEach((name, i) => {
    const c = /** @type {any} */ (v)[name];
    if (!c || typeof c !== "object") return;
    out[name] = {
      label: c.label != null && c.label !== "" ? String(c.label) : name,
      shape: Object.prototype.hasOwnProperty.call(MARK_PATHS, String(c.shape)) ? String(c.shape) : "circle",
      hollow: c.fill === "hollow",
      color: colorVar(c.color || "text-muted", i),
    };
  });
  return out;
}

/**
 * @component scatterChart
 * @title Scatter Chart
 * @category Charts
 * @summary An SVG scatter chart of points on two numeric axes, labelled beside them or only by tip, with point classes by shape and fill, an active point and dashed reference lines.
 * @param {{title?: string, data: Array<{x: number|null, y: number|null, label: string, active?: boolean, cls?: string}>, classes?: Record<string, {label?: string, shape?: "circle"|"diamond"|"triangle"|"square", fill?: "solid"|"hollow", color?: string}>, labels?: "all"|"active"|"none", refLines?: Array<{axis: "x"|"y", value: number, label: string}>, xLabel?: string, yLabel?: string, xDomain?: [number, number], yDomain?: [number, number], yStep?: number, format?: "percent"|"number", activeLabel?: string, activeShape?: "circle"|"diamond"|"triangle"|"square", grid?: boolean, height?: number, width?: number, k?: string, enter?: boolean, emptyText?: string}} p
 * Each point is drawn at (`x`, `y`) and labelled beside it; a label that would overlap a point or another label moves to the left, above, below, or steps up or down with a leader line (no solver, so a dense cluster can still touch). The point with `active: true` is drawn larger in `--accent` and its label adds `activeLabel` in brackets (default "active"; a caller passes its own word, such as "active rule"), so it is never told by colour alone; the others are neutral. `xDomain` and `yDomain` fix the axes (default: nice ticks from 0 over the data); `format` ("number" by default, or "percent") formats both axes, tips and the table. `xLabel` and `yLabel` title the axes and name the values in tips. A point with a null, missing or non-numeric x or y is not plotted, and neither is a point outside fixed axes; a note under the chart counts both. The chart is `height` px tall (default 250) and `width` units wide (default 600); mount `chartFitIsland` to draw it at its container's width.
 * `classes` names point classes, each `{label, shape, fill, color?}` (`shape` circle, diamond, triangle or square; `fill` "solid" or "hollow"; `color` a token name, default `text-muted`), and a point's `cls` picks one: it is drawn in that shape and fill, its label and tip add the class label in brackets, and the legend lists every class. A point without a known class is drawn as before; `active` is the built-in class it always was (larger, in `--accent`, with `activeLabel`). `labels` is "all" (default), "active" (only the active point is labelled beside it) or "none" (for a dense chart: tips and the table still name every point). `refLines` (`{axis, value, label}`) are dashed lines at a value of x or y, labelled beside them as on lineChart, and listed in a second sr-only table; one outside the axes is left out. About 200 points draw fine with `labels: "none"`, which skips label placement.
 * `activeShape` ("diamond", "triangle" or "square") draws the active point in that shape, a quarter larger, still in `--accent` and still with its `activeLabel` word. `yStep` puts the y ticks on multiples of a step, widened when the labels would sit closer than 16 units.
 * @emits none
 * @states default, missing, idle, active-shape, empty
 * @a11y The svg is an image named by `title`. Every plotted point is a focusable group (tab stop) whose tip and label name the point, both values and the active word; the label beside it is the same text. A sr-only table after the svg lists every point, and "not measurable" for a missing value. The active point differs by size and by its word as well as colour; a class differs by shape and fill as well as colour, and its word is in the tip, the label and the table. Reference lines are dashed and labelled.
 * @example default: scatterChart({ title: "Acme rules: coverage against efficiency", xLabel: "Coverage", yLabel: "Efficiency", format: "percent", xDomain: [0, 100], yDomain: [0, 100], activeLabel: "active rule", data: [{ x: 82, y: 64, label: "Rule A", active: true }, { x: 45, y: 71, label: "Rule B" }, { x: 47, y: 69, label: "Rule C" }, { x: 20, y: 30, label: "Rule D" }, { x: 91, y: 22, label: "Rule E" }], k: "sc-a" })
 * @example missing: scatterChart({ title: "Acme rules", xLabel: "Coverage", yLabel: "Efficiency", format: "percent", data: [{ x: 60, y: 40, label: "Rule A" }, { x: 35, y: 75, label: "Rule B", active: true }, { x: null, y: 50, label: "Rule C" }, { x: 70, y: null, label: "Rule D" }], k: "sc-b" })
 * @example idle: scatterChart({ title: "Acme repositories: days idle against open findings", xLabel: "Days idle", yLabel: "Open findings", labels: "none", xDomain: [0, 180], yDomain: [0, 40], classes: { cold: { label: "Cold", shape: "diamond", fill: "solid", color: "accent" }, warm: { label: "Warm", shape: "circle", fill: "hollow" } }, refLines: [{ axis: "x", value: 90, label: "cold at 90 d (relative)" }], data: [{ x: 4, y: 12, label: "api", cls: "warm" }, { x: 9, y: 25, label: "web", cls: "warm" }, { x: 15, y: 8, label: "auth", cls: "warm" }, { x: 22, y: 31, label: "jobs", cls: "warm" }, { x: 30, y: 17, label: "docs", cls: "warm" }, { x: 41, y: 6, label: "cli", cls: "warm" }, { x: 55, y: 21, label: "etl", cls: "warm" }, { x: 63, y: 14, label: "mail", cls: "warm" }, { x: 77, y: 27, label: "maps", cls: "warm" }, { x: 96, y: 11, label: "legacy", cls: "cold" }, { x: 118, y: 19, label: "billing", cls: "cold" }, { x: 135, y: 4, label: "search", cls: "cold" }, { x: 152, y: 33, label: "reports", cls: "cold" }, { x: 171, y: 9, label: "archive", cls: "cold" }], k: "sc-c" })
 * @example active-shape: scatterChart({ title: "Acme rules: coverage against efficiency", xLabel: "Coverage", yLabel: "Efficiency", format: "percent", xDomain: [0, 100], yDomain: [0, 100], yStep: 20, activeShape: "diamond", activeLabel: "active rule", data: [{ x: 82, y: 64, label: "Rule A", active: true }, { x: 45, y: 71, label: "Rule B" }, { x: 20, y: 30, label: "Rule D" }, { x: 91, y: 22, label: "Rule E" }], k: "sc-d" })
 * @example empty: scatterChart({ title: "Acme rules", data: [] })
 */
export function scatterChart(p) {
  const q = p || /** @type {any} */ ({});
  const name = nameOf(q, "Scatter chart");
  const classes = classesOf(q.classes);
  const pts = (Array.isArray(q.data) ? q.data : []).filter((d) => d && typeof d === "object").map((d, i) => {
    const c = typeof d.cls === "string" && Object.prototype.hasOwnProperty.call(classes, d.cls) ? classes[d.cls] : null;
    return {
      i,
      x: num(d.x, NaN),
      y: num(d.y, NaN),
      active: d.active === true,
      cls: c,
      text: (d.label != null && d.label !== "" ? String(d.label) : "Point " + (i + 1)) + (c ? " (" + c.label + ")" : "") + (d.active === true ? " (" + (q.activeLabel ? String(q.activeLabel) : "active") + ")" : ""),
    };
  });
  if (!pts.length) return emptyView("scatter", name, q.emptyText);
  const k = q.k || "chart";
  const fmt = valueFmt({ valueFormat: q.format === "percent" ? "percent" : "number" });
  const xl = q.xLabel ? String(q.xLabel) : "x";
  const yl = q.yLabel ? String(q.yLabel) : "y";
  const box = plotBox({ height: q.height, width: q.width, axes: { x: true, y: true } }, { top: 28, bottom: 26 });
  const measured = pts.filter((d) => d.x === d.x && d.y === d.y);
  /** A fixed domain, or nice ticks from 0 over the measured values. @param {unknown} v @param {"x"|"y"} key @returns {[number, number]} */
  const dom = (v, key) => {
    const vs = measured.map((d) => /** @type {number} */ (d[key]));
    const t = niceTicks(Math.min(0, ...vs), Math.max(0, ...vs), 4);
    return domainPair(v) || [t.min, t.max];
  };
  const xd = dom(q.xDomain, "x");
  const yd = dom(q.yDomain, "y");
  const x = linearScale(xd[0], xd[1], box.l, box.w - box.r);
  const sc = yScaleFor(0, 0, box.t, box.h - box.b, yd, q.yStep);
  // activeShape draws the active point in a marker shape, a quarter larger, instead of the circle.
  const aShape = q.activeShape !== "circle" && Object.prototype.hasOwnProperty.call(MARK_PATHS, String(q.activeShape)) ? /** @type {keyof typeof MARK_PATHS} */ (q.activeShape) : null;
  // Inactive points first and the active one last, so it is drawn on top; its label is placed first.
  const shown = measured.filter((d) => /** @type {number} */ (d.x) >= xd[0] && /** @type {number} */ (d.x) <= xd[1] && /** @type {number} */ (d.y) >= yd[0] && /** @type {number} */ (d.y) <= yd[1])
    .sort((a, b) => Number(a.active) - Number(b.active) || /** @type {number} */ (a.x) - /** @type {number} */ (b.x));
  const at = shown.map((d) => ({ x: x(/** @type {number} */ (d.x)), y: sc.y(/** @type {number} */ (d.y)), r: d.active && aShape ? 8 : d.active || d.cls ? 6 : 4, text: d.text }));
  // Only the labelled points are placed (the rest are obstacles); "none" skips placement.
  const mode = q.labels === "none" || q.labels === "active" ? q.labels : "all";
  const lab = shown.map((d) => mode === "all" || (mode === "active" && d.active));
  const placedL = mode === "none" ? [] : placeLabels(at.filter((a, j) => lab[j]).reverse(), { l: 0, t: box.t - 10, r: box.w, b: box.h - box.b }, at.filter((a, j) => !lab[j])).reverse();
  let n = 0;
  const placed = lab.map((on) => (on ? placedL[n++] : null));
  const marks = shown.map((d, j) => {
    const a = at[j];
    const lb = placed[j];
    const tip = d.text + ": " + xl + " " + fmt(/** @type {number} */ (d.x)) + ", " + yl + " " + fmt(/** @type {number} */ (d.y));
    const c = d.active ? null : d.cls;
    const dot = d.active && aShape
      ? html`<path class="gk-scatter__dot" transform="translate(${r2(a.x)} ${r2(a.y)}) scale(1.25)" d="${MARK_PATHS[aShape]}"></path>`
      : c ? html`<path class="gk-scatter__mark${c.hollow ? " is-hollow" : ""}" style="--c:${cssValue(c.color)}" transform="translate(${r2(a.x)} ${r2(a.y)})" d="${MARK_PATHS[/** @type {keyof typeof MARK_PATHS} */ (c.shape)]}"></path>`
      : html`<circle class="gk-scatter__dot" cx="${r2(a.x)}" cy="${r2(a.y)}" r="${a.r}"></circle>`;
    const text = lb ? html`<text class="gk-scatter__label" x="${r2(lb.x)}" y="${r2(lb.y)}" dy="0.32em" text-anchor="${lb.anchor}">${d.text}</text>` : "";
    return html`<g class="gk-scatter__pt${d.active ? " is-active" : ""}" tabindex="0" role="img" data-k="${k}-pt-${d.i}" data-tip="${tip}" aria-label="${tip}"><circle class="gk-chart__hit" cx="${r2(a.x)}" cy="${r2(a.y)}" r="10"></circle>${lb && lb.leader ? html`<line class="gk-scatter__leader" x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(lb.x)}" y2="${r2(lb.y)}"></line>` : ""}${dot}${text}</g>`;
  });
  /** @type {Array<{vx: boolean, v: number, label: string}>} */
  const refs = [];
  (Array.isArray(q.refLines) ? q.refLines : []).forEach((rl) => {
    const vx = !!rl && rl.axis === "x";
    const v = rl && (vx || rl.axis === "y") ? num(rl.value, NaN) : NaN;
    const d = vx ? xd : yd;
    if (v === v && v >= d[0] && v <= d[1]) refs.push({ vx, v, label: String(rl.label == null ? "" : rl.label) });
  });
  const refView = refLinesView(box, refs.map((r) => ({ vx: r.vx, at: r.vx ? x(r.v) : sc.y(r.v), label: r.label })));
  const titles = html`<g class="gk-scatter__title" aria-hidden="true"><text x="${box.l}" y="12" text-anchor="middle">${yl}</text><text x="${box.w - box.r}" y="${box.h - 4}" text-anchor="end">${xl}</text></g>`;
  const body = html`${gridView(box, sc.ticks, sc.y, { grid: q.grid !== false, fmt })}${refView}${xTicks(box, fitLinearTicks(xd[0], xd[1], x, box.iw, box.w, fmt))}${titles}${marks}`;
  const missing = pts.length - measured.length;
  const outside = measured.length - shown.length;
  const note = missing || outside ? html`<p class="gk-scatter__note">${"Not plotted: " + [missing ? missing + " not measurable" : "", outside ? outside + " outside the axes" : ""].filter(Boolean).join(", ")}</p>` : "";
  const na = (/** @type {number} */ v) => (v === v ? fmt(v) : "not measurable");
  const table = tableView(name, ["Point", xl, yl], pts.map((d) => [d.text, na(d.x), na(d.y)]));
  const refTable = refs.length ? tableView(name + ": reference lines", ["Reference line", xl, yl], refs.map((r) => [r.label, r.vx ? fmt(r.v) : "–", r.vx ? "–" : fmt(r.v)])) : "";
  const names = Object.keys(classes);
  const legend = names.length ? html`${legendView(names.map((c) => ({ label: classes[c].label, color: classes[c].color, pattern: classes[c].shape, hollow: classes[c].hollow })))}${note}` : note;
  return frameView({ q, kind: "scatter", view: scatterChart, vw: box.w, vh: box.h, fit: true, defs: "", body, legend, table: html`${table}${refTable}`, name });
}

