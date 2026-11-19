// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG line chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { cssValue, html } from "@gas-kit/client/html.js";
import { areaPath, colorVar, curvePath, dayFmt, fitLinearTicks, fmtNum, linearScale, MARK_PATHS, num, pointScale, r2, timeTicks, valueAt, ymdDay } from "./chartModel.js";
import { categoryTarget, catText, domainPair, emptyView, frameView, gridView, idPrefix, legendView, markStyle, nameOf, patternDefs, plotBox, refLinesView, rowsOf, seriesOf, tableView, valueFmt, wantLegend, xTicks, yScaleFor } from "./chartParts.js";

const CURVES = ["natural", "linear", "step", "stepAfter", "monotone"];

/**
 * @component lineChart
 * @title Line Chart
 * @category Charts
 * @summary An SVG line chart over a row per category, a number or a date: one or more lines with optional dots, value labels, markers and reference lines.
 * @param {{title?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots", fill?: boolean, legend?: boolean}>, xScale?: "category"|"linear"|"time", xDomain?: [number|string, number|string], yDomain?: [number, number], yStep?: number, dateFormat?: "d mmm"|"dd-mmm-yyyy"|"yyyy-mm-dd", xLabel?: string, markers?: Array<{x: number|string, y?: number, series?: string, label: string, shape?: "circle"|"triangle"|"square"|"diamond", color?: string}>, refLines?: Array<{axis: "x"|"y", value: number|string, label: string}>, bands?: Array<{from: number|string, to: number|string, label: string, pattern?: "stripes"|"dots"}>, curve?: "natural"|"linear"|"step"|"stepAfter"|"monotone", dots?: boolean, labels?: boolean, legend?: boolean, grid?: boolean, axes?: boolean|{x?: boolean, y?: boolean}, height?: number, width?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact"|"signed", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact"|"signed"}} p
 * `series[].color` is `chart-1` to `chart-6` or another token name. `dots` draws a 4px dot per point; `labels` writes each value above its point. The stroke is 2px. With several series, `pattern` also gives each line a dash style (stripes: dashed, dots: dotted) so colour is never the only signal. `k` namespaces ids and keys; `enter` makes the lines draw in. Wrap it in a card: `card({ title, description, content: lineChart(...) })`. The chart is `height` px tall (default 250) and `width` units wide (default 600), full width of its container; a narrow `width` is drawn as given down to 80 units (never replaced by 600), so a chart in a narrow card or phone column keeps its 12px text. Mount `chartFitIsland` for a full-width chart: it redraws at the measured width so the text stays 12px. A function `valueFormat` or `xFormat` cannot travel as data, so such a chart keeps the static width; use the names "number", "percent" or "compact" to keep it fit.
 * `xScale` is "category" by default (one evenly spaced point per row, as before). With "linear" the `xKey` values are numbers and with "time" they are `yyyy-MM-dd` strings (read as UTC day numbers, never through `new Date`); either way points sit in proportion to their value, rows are sorted by it, a row without a valid x is left out, and a missing y is a gap in that line (never a zero). Ticks are picked so their 12px labels never overlap (time ticks step by days, weeks, months or years). `xDomain: [min, max]` clips the x axis (dates as strings for "time", whose values read "7 Mar 2025" and take no `xFormat`), `yDomain: [min, max]` fixes the y axis (on any scale); lines are clipped to the plot, and points outside it are not drawn or listed. `xLabel` names the x values in tips and the table (default `xKey`). "stepAfter" holds each value until the next point, as a survival curve does ("step" changes at the midpoint).
 * `markers` are shaped points drawn above the lines and named in the legend by shape (`circle`, `triangle`, `square`, `diamond`): at `x` (a category value, a number or a date, as the axis takes) and `y`, or, without `y`, on the line of `series` (a series key, default the first) at that x, read the way the curve is drawn (the held value of a step curve, the straight line between neighbours otherwise). `color` is a token name (default `text`). A marker with a null x, outside the axes, or with no value at its x is left out. `refLines` are dashed lines across the plot at a `value` of the x or y axis, each with its `label` written beside it.
 * `bands` shade x ranges behind the lines, each `{from, to, label, pattern?}` in the axis's values (a category, a number or a date), such as the rebuilt prefix of a series: hatched ("stripes" by default, or "dots") in a muted tone so the cue is never colour alone, clipped to the x axis, named in the legend by a swatch of the same hatch, and listed with its range in the second sr-only table. A band with a missing end, or wholly outside the axis, is left out.
 * `dateFormat` names how a time axis writes its dates in ticks, tips and the table: "d mmm" (the default: ticks "7 Mar", tips "7 Mar 2026"), "dd-mmm-yyyy" ("07-mar-2026", a lower-case month) or "yyyy-mm-dd"; with either of the last two every tick reads the full date. `yStep` puts the y ticks on multiples of a step (10 on a 0 to 100 axis), widened when the labels would sit closer than 16 units. `valueFormat: "signed"` writes +12, −5 and 0. `series[].fill: true` draws a faint area of the series colour under that line, down to zero or the nearer end of the y axis; `series[].legend: false` leaves a series out of the legend, never out of the tips or the table. All of them are data, so the chart keeps its fit mount.
 * @emits none
 * @states default, linear, step, multiple, dots, labels, time, linear-step-markers, bands, fill-dates, empty
 * @a11y Apps mount chartFitIsland for a full-width chart; without it the chart still works at its fixed height. The svg is an image named by `title`; every category or point is one focusable group (tab stop) whose tip and label read all series, and every marker is a tab stop of its own whose tip and label give its label, x and value. A sr-only table after the svg lists the same data, and a second one lists the markers and reference lines; each sits in a 1px clipping box, so long names never widen the page at phone width. More than one series always shows the legend, dashed or dotted strokes tell lines apart without colour, markers differ by shape, reference lines are dashed and labelled, and shaded ranges are hatched and named in the legend and the table.
 * @example default: lineChart({ title: "Visitors", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }, { m: "May", d: 209 }, { m: "Jun", d: 214 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-a" })
 * @example linear: lineChart({ title: "Visitors", curve: "linear", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-b" })
 * @example step: lineChart({ title: "Visitors", curve: "step", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-c" })
 * @example multiple: lineChart({ title: "Visitors by device", curve: "monotone", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }, { m: "Apr", d: 73, mo: 190 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "dots" }], k: "line-d", enter: true })
 * @example dots: lineChart({ title: "Visitors", dots: true, curve: "linear", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-e" })
 * @example labels: lineChart({ title: "Visitors", dots: true, labels: true, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-f" })
 * @example time: lineChart({ title: "Acme coverage by sync", xScale: "time", curve: "linear", dots: true, yDomain: [0, 100], valueFormat: "percent", axes: { y: true }, data: [{ day: "2025-01-06", a: 42, b: 30 }, { day: "2025-01-09", a: 45, b: 31 }, { day: "2025-02-03", a: 51, b: 38 }, { day: "2025-02-10", a: 50, b: 44 }, { day: "2025-03-24", a: 63, b: 47 }, { day: "2025-04-28", a: 71, b: 52 }], xKey: "day", series: [{ key: "a", label: "Scanned" }, { key: "b", label: "Fixed", color: "chart-2", pattern: "stripes" }], refLines: [{ axis: "y", value: 60, label: "Target 60%" }], k: "line-g" })
 * @example linear-step-markers: lineChart({ title: "Acme findings still open", xScale: "linear", xLabel: "Week", curve: "stepAfter", xDomain: [0, 26], yDomain: [0, 100], valueFormat: "percent", axes: { y: true }, data: [{ w: 0, open: 100 }, { w: 2, open: 91 }, { w: 4, open: 78 }, { w: 7, open: 64 }, { w: 9, open: 50 }, { w: 13, open: 41 }, { w: 18, open: 30 }, { w: 24, open: 22 }, { w: 30, open: 15 }], xKey: "w", series: [{ key: "open", label: "Still open" }], markers: [{ x: 9, series: "open", label: "Median", shape: "diamond" }, { x: 11.4, series: "open", label: "Mean", shape: "triangle", color: "chart-3" }], refLines: [{ axis: "x", value: 12, label: "Target" }], k: "line-h" })
 * @example bands: lineChart({ title: "Acme open findings by week", xScale: "time", curve: "linear", dots: true, axes: { y: true }, data: [{ day: "2025-01-06", open: 120 }, { day: "2025-01-13", open: 126 }, { day: "2025-01-20", open: 131 }, { day: "2025-01-27", open: 129 }, { day: "2025-02-03", open: 138 }, { day: "2025-02-10", open: 134 }, { day: "2025-02-17", open: 127 }, { day: "2025-02-24", open: 121 }, { day: "2025-03-03", open: 116 }], xKey: "day", series: [{ key: "open", label: "Open" }], bands: [{ from: "2025-01-06", to: "2025-01-27", label: "Rebuilt from history, not observed" }], k: "line-i" })
 * @example fill-dates: lineChart({ title: "Acme scan coverage", xScale: "time", dateFormat: "dd-mmm-yyyy", curve: "linear", yDomain: [0, 100], yStep: 10, valueFormat: "percent", axes: { y: true }, data: [{ day: "2026-03-07", c: 48, t: 80 }, { day: "2026-03-14", c: 55, t: 80 }, { day: "2026-03-21", c: 61, t: 80 }, { day: "2026-03-28", c: 58, t: 80 }, { day: "2026-04-04", c: 70, t: 80 }, { day: "2026-04-11", c: 76, t: 80 }], xKey: "day", series: [{ key: "c", label: "Covered", fill: true }, { key: "t", label: "Goal", color: "text-muted", pattern: "stripes", legend: false }], k: "line-j" })
 * @example empty: lineChart({ title: "Visitors", data: [], xKey: "m", series: [{ key: "d", label: "Desktop" }] })
 */
export function lineChart(p) {
  const q = p || /** @type {any} */ ({});
  const mode = q.xScale === "linear" || q.xScale === "time" ? q.xScale : "category";
  const cat = mode === "category";
  const series = seriesOf(q);
  const name = nameOf(q, "Line chart");
  /** @type {(v: unknown) => number|null} */
  const xParse = mode === "time" ? ymdDay : (v) => { const n = num(v, NaN); return n === n ? n : null; };
  // Category rows keep their order and their index as x; numeric rows are sorted by their value.
  /** @type {Array<{r: Record<string, unknown>, xv: number}>} */
  const pts = [];
  rowsOf(q).forEach((r, i) => { const xv = cat ? i : xParse(r[q.xKey]); if (xv != null) pts.push({ r, xv }); });
  pts.sort((a, b) => a.xv - b.xv);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const curve = CURVES.indexOf(String(q.curve)) >= 0 ? q.curve : "natural";
  const box = plotBox(q, { top: q.labels ? 28 : 12 });
  // A missing value is a gap (NaN) on a numeric axis, a zero on a category one as before.
  const vals = series.map((s) => pts.map((o) => num(o.r[s.key], cat ? 0 : NaN)));
  const finite = /** @type {number[]} */ ([]).concat(...vals).filter((n) => n === n);
  if (!finite.length) return emptyView("line", name, q.emptyText);
  const yDom = domainPair(q.yDomain);
  const sc = yScaleFor(Math.min(...finite), Math.max(...finite), box.t, box.h - box.b, yDom, q.yStep);
  const lo = pts[0].xv;
  const hi = pts[pts.length - 1].xv;
  const fixed = cat ? null : domainPair(q.xDomain, xParse);
  const xDom = fixed || (lo === hi ? [lo - 1, hi + 1] : [lo, hi]);
  const x = cat ? pointScale(pts.length, box.l, box.w - box.r) : linearScale(xDom[0], xDom[1], box.l, box.w - box.r);
  const inX = (/** @type {number} */ v) => v >= xDom[0] && v <= xDom[1];
  const inY = (/** @type {number|null} */ v) => v != null && v >= sc.min && v <= sc.max;
  /** The text of an x value: the category cell, the date, or the number after `xLabel`. @param {number} xv */
  const xText = (xv) => (cat ? catText(q, pts[xv].r[q.xKey])
    : mode === "time" ? dayFmt(xv, q.dateFormat)
      : (q.xLabel ? q.xLabel + " " : "") + (q.xFormat ? catText(q, xv) : fmtNum(xv)));
  const vfmt = (/** @type {number} */ v) => (v === v ? fmt(v) : "no value");
  const shown = pts.map((o, i) => i).filter((i) => inX(pts[i].xv));
  const cats = pts.map((o) => xText(o.xv));
  const px = (/** @type {number} */ i) => x(pts[i].xv);
  const yOf = (/** @type {{index: number}} */ s, /** @type {number} */ i) => /** @type {number} */ (vals[s.index][i]);
  const dot = (/** @type {import("./chartParts.js").ChartSeries} */ s, /** @type {number} */ i, /** @type {string} */ cls) => html`<circle class="gk-chart__dot${cls}" cx="${r2(px(i))}" cy="${r2(sc.y(yOf(s, i)))}" r="4" style="--c:${cssValue(s.color)}" data-tip="${cats[i] + ": " + s.label + " " + fmt(yOf(s, i))}"></circle>`;
  // A series with `fill` gets a faint area under its line, down to zero (or the nearer end of the axis).
  const floor = sc.y(Math.min(sc.max, Math.max(sc.min, 0)));
  const fills = series.filter((s) => s.fill).map((s) => {
    const top = pts.map((o, i) => /** @type {[number, number]} */ ([px(i), sc.y(yOf(s, i))])).filter((pt) => pt[1] === pt[1]);
    return html`<path class="gk-chart__fill" style="--c:${cssValue(s.color)}" d="${areaPath(top, top.map((pt) => /** @type {[number, number]} */ ([pt[0], floor])), curve)}"></path>`;
  });
  const lines = series.map((s) => {
    const pp = pts.map((o, i) => /** @type {[number, number]} */ ([px(i), sc.y(yOf(s, i))]));
    const on = shown.filter((i) => cat || inY(vals[s.index][i]));
    const dash = s.pattern === "stripes" ? " is-dashed" : s.pattern === "dots" ? " is-dotted" : "";
    // pathLength="1" serves the entrance (a dash of 1 drawn in), which a patterned line skips; on
    // a patterned line it would rescale the 6 4 or 1 5 dashes to path units and draw it solid.
    return html`<path class="gk-chart__line${dash}" style="--c:${cssValue(s.color)}"${dash ? "" : html` pathLength="1"`} d="${curvePath(pp, curve)}"></path>${q.dots ? on.map((i) => dot(s, i, " is-shown")) : ""}${q.labels ? on.map((i) => html`<text class="gk-chart__value" x="${r2(pp[i][0])}" y="${r2(pp[i][1] - 12)}" text-anchor="middle" aria-hidden="true">${fmt(yOf(s, i))}</text>`) : ""}`;
  });
  const targets = shown.map((i, j) => {
    const xl = j === 0 ? box.l : (px(shown[j - 1]) + px(i)) / 2;
    const xr = j === shown.length - 1 ? box.w - box.r : (px(i) + px(shown[j + 1])) / 2;
    const tip = cats[i] + ": " + series.map((s) => s.label + " " + vfmt(vals[s.index][i])).join(", ");
    const inner = html`<line class="gk-chart__cursor" x1="${r2(px(i))}" x2="${r2(px(i))}" y1="${box.t}" y2="${box.h - box.b}"></line>${q.dots ? "" : series.filter((s) => cat || inY(vals[s.index][i])).map((s) => dot(s, i, ""))}`;
    return categoryTarget({ k, i, tip, x: xl, y: box.t, w: xr - xl, h: box.h - box.t, inner });
  });
  /** A value of the x axis as an x value (a category's row index), or null. @param {unknown} v */
  const xRaw = (v) => {
    const n = v == null || v === "" ? null : cat ? pts.findIndex((o) => String(o.r[q.xKey]) === String(v)) : xParse(v);
    return n == null || (cat && n < 0) ? null : n;
  };
  /** A marker or reference x as an x value, or null off the axis. @param {unknown} v */
  const xOf = (v) => {
    const n = xRaw(v);
    return n != null && inX(n) ? n : null;
  };
  // Markers and reference lines become one list of marks: the drawing differs, the table row is shared.
  /** @type {Array<{i: number, label: string, xv: number|null, yv: number|null, on: string, shape: string, color: string}>} */
  const marks = [];
  (Array.isArray(q.markers) ? q.markers : []).forEach((m, i) => {
    const xv = m && typeof m === "object" ? xOf(m.x) : null;
    if (xv == null) return;
    const s = series.find((t) => t.key === m.series) || series[0];
    const own = num(m.y, NaN);
    const yv = own === own ? own : valueAt(pts.map((o, j) => /** @type {[number, number]} */ ([o.xv, yOf(s, j)])), xv, curve);
    if (!inY(yv)) return;
    marks.push({ i, label: m.label != null && m.label !== "" ? String(m.label) : "Marker " + (i + 1), xv, yv, on: own === own ? "" : s.label + " ", shape: Object.prototype.hasOwnProperty.call(MARK_PATHS, String(m.shape)) ? String(m.shape) : "circle", color: colorVar(m.color || "text", i) });
  });
  const markers = marks.slice();
  (Array.isArray(q.refLines) ? q.refLines : []).forEach((rl, i) => {
    const isX = rl && rl.axis === "x";
    const v = isX ? xOf(rl.value) : rl && rl.axis === "y" ? num(rl.value, NaN) : NaN;
    if (v != null && (isX || inY(v))) marks.push({ i, label: String(rl.label == null ? "" : rl.label), xv: isX ? v : null, yv: isX ? null : v, on: "", shape: "", color: "" });
  });
  const refView = refLinesView(box, marks.filter((m) => !m.shape).map((m) => ({ vx: m.xv != null, at: m.xv != null ? x(/** @type {number} */ (m.xv)) : sc.y(/** @type {number} */ (m.yv)), label: m.label })));
  const markView = markers.map((m) => {
    const cx = x(/** @type {number} */ (m.xv));
    const cy = sc.y(/** @type {number} */ (m.yv));
    const tip = m.label + ": " + xText(/** @type {number} */ (m.xv)) + ", " + m.on + fmt(/** @type {number} */ (m.yv));
    return html`<g class="gk-chart__marker" tabindex="0" role="img" data-k="${k}-mk-${m.i}" data-tip="${tip}" aria-label="${tip}"><circle class="gk-chart__hit" cx="${r2(cx)}" cy="${r2(cy)}" r="10"></circle><path class="gk-chart__mark" style="--c:${cssValue(m.color)}" transform="translate(${r2(cx)} ${r2(cy)})" d="${MARK_PATHS[/** @type {keyof typeof MARK_PATHS} */ (m.shape)]}"></path></g>`;
  });
  // Shaded x ranges: hatched in a muted tone, clipped to the axis, named in the legend and the table.
  /** @type {Array<{a: number, b: number, s: import("./chartParts.js").ChartSeries}>} */
  const bands = [];
  (Array.isArray(q.bands) ? q.bands : []).forEach((bd) => {
    const f = bd && typeof bd === "object" ? xRaw(bd.from) : null;
    const t = bd && typeof bd === "object" ? xRaw(bd.to) : null;
    if (f == null || t == null) return;
    const a = Math.max(xDom[0], Math.min(f, t));
    const b = Math.min(xDom[1], Math.max(f, t));
    if (!(b > a)) return;
    const i = bands.length;
    bands.push({ a, b, s: { key: "band" + i, label: bd.label != null && bd.label !== "" ? String(bd.label) : "Range " + (i + 1), color: "var(--text-muted)", pattern: bd.pattern === "dots" ? "dots" : "stripes", index: i } });
  });
  const bandView = bands.length ? html`<g class="gk-chart__bands" aria-hidden="true">${bands.map((bd) => html`<rect class="gk-chart__band" x="${r2(x(bd.a))}" y="${box.t}" width="${r2(x(bd.b) - x(bd.a))}" height="${box.ih}" style="${markStyle(bd.s, pre)}"></rect>`)}</g>` : "";
  const ticks = cat
    ? xTicks(box, cats.map((c, i) => ({ x: x(i), text: c })))
    : xTicks(box, mode === "time" ? timeTicks(xDom[0], xDom[1], x, box.iw, box.w, q.dateFormat === "dd-mmm-yyyy" || q.dateFormat === "yyyy-mm-dd" ? (d) => dayFmt(d, q.dateFormat) : undefined) : fitLinearTicks(xDom[0], xDom[1], x, box.iw, box.w, (v) => (q.xFormat ? catText(q, v) : fmtNum(v))));
  const clip = !!(fixed || yDom);
  const defs = html`${clip ? html`<clipPath id="${pre}-clip"><rect x="${box.l - 3}" y="${box.t - 3}" width="${box.iw + 6}" height="${box.ih + 6}"></rect></clipPath>` : ""}${patternDefs(pre, bands.map((bd) => bd.s))}`;
  const body = html`${gridView(box, sc.ticks, sc.y, { grid: q.grid !== false, fmt })}${bandView}${refView}${clip ? html`<g clip-path="url(#${pre}-clip)">${fills}${lines}</g>` : html`${fills}${lines}`}${ticks}${targets}${markView}`;
  const xHead = String((!cat && q.xLabel) || q.xKey || "");
  const table = tableView(name, [xHead, ...series.map((s) => s.label)], shown.map((i) => [cats[i], ...series.map((s) => vfmt(vals[s.index][i]))]));
  const extra = marks.length || bands.length
    ? tableView(name + (bands.length ? ": markers, reference lines and shaded ranges" : ": markers and reference lines"), ["Mark", xHead, "Value"], [
      ...marks.map((m) => [m.shape ? m.label : m.label + " (reference line)", m.xv == null ? "–" : xText(m.xv), m.yv == null ? "–" : m.on + fmt(m.yv)]),
      ...bands.map((bd) => [bd.s.label + " (shaded range)", xText(bd.a) + " to " + xText(bd.b), "–"]),
    ])
    : "";
  const legend = wantLegend(q, series.length) || markers.length || bands.length ? legendView([...series, ...markers.map((m) => ({ label: m.label, color: m.color, pattern: m.shape })), ...bands.map((bd) => bd.s)]) : "";
  return frameView({ q, kind: "line", view: lineChart, vw: box.w, vh: box.h, fit: true, defs, body, legend, table: html`${table}${extra}`, name });
}
