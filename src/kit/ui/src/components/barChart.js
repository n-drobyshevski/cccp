// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG bar chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { html } from "@gas-kit/client/html.js";
import { bandScale, CHAR_PX, colorVar, linearScale, num, r2, roundRectPath, stackSeries } from "./chartModel.js";
import { categoryTarget, catText, emptyView, frameView, gridView, idPrefix, legendView, markStyle, nameOf, patternDefs, plotBox, rowsOf, seriesOf, tableView, valueFmt, wantLegend, xTicks, yScaleFor } from "./chartParts.js";

const BAR_PATTERNS = ["stripes", "dots", "none"];
const SWATCHES = ["stripes", "dots", "none", "circle", "triangle", "square", "diamond"];

/**
 * @component barChart
 * @title Bar Chart
 * @category Charts
 * @summary An SVG bar chart: vertical or horizontal, one series or several (grouped or stacked), with value labels, negative values, an active bar and per-row colours.
 * @param {{title?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, orientation?: "vertical"|"horizontal", stacked?: boolean, labels?: boolean, negative?: boolean, activeIndex?: number, colorKey?: string, patternKey?: string, categoryLabels?: string|((row: Record<string, unknown>) => unknown), zeroLabel?: string, zeroLabelStyle?: "text"|"pill", labelTrim?: "end"|"start", barMaxWidth?: number, yStep?: number, legendExtra?: Array<{label: string, pattern?: "none"|"stripes"|"dots"|"circle"|"triangle"|"square"|"diamond", color?: string}>, radius?: number, legend?: boolean, grid?: boolean, axes?: boolean|{x?: boolean, y?: boolean}, height?: number, width?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact"|"signed", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact"|"signed"}} p
 * Several series are grouped side by side; `stacked` stacks them. `labels` writes the value at the end of each bar (not on stacks). `negative` colours values below zero with `chart-2` (a single series). `activeIndex` draws that row's bar at .8 opacity with a dashed outline. `colorKey` names a row field holding `chart-1` to `chart-6` (or a token name) for a colour per row (a single series). `patternKey` names a row field holding "stripes", "dots" or "none", which textures (or plainly fills) every bar of that row over its series pattern, such as the months that were not observed. `categoryLabels` writes a text per row, from a row field (a string) or a function of the row: above the group (vertical) or in a column beside it (horizontal), such as a signed net; a function cannot travel as data, so such a chart keeps the static width. On a horizontal chart the category names take a column of up to 110 units, or up to 40% of a wider chart, and a name that still does not fit is cut with an ellipsis at its end, or at its start with `labelTrim: "start"` (for paths such as org/repo/branch, whose end tells them apart); the tip and the table keep the whole name. `zeroLabel` draws the zero rule (across a horizontal chart too) and writes the text on it, such as the net of a diverging chart. `legendExtra` adds legend entries after the series (alone, for one series without `legend`), each `{label, pattern?, color?}` (a pattern or marker shape and a token name, default `text-muted`): a hatch's meaning, or the two directions of a diverging chart. `radius` overrides the corner radius (default 8 single, 5 horizontal, 4 grouped or stacked). `k` namespaces ids and keys; `enter` makes the bars grow in. Wrap it in a card: `card({ title, description, content: barChart(...), footer })`. The chart is `height` px tall (default 250) and `width` units wide (default 600), full width of its container; a narrow `width` is drawn as given down to 80 units (never replaced by 600), so a chart in a narrow card or phone column keeps its 12px text. Mount `chartFitIsland` for a full-width chart: it redraws at the measured width so the text stays 12px. A function `valueFormat` or `xFormat` cannot travel as data, so such a chart keeps the static width; use the names "number", "percent" or "compact" to keep it fit.
 * `zeroLabelStyle: "pill"` writes `zeroLabel` in a dark pill (the `text` token behind `bg` ink, so it reads in light and dark) instead of plain text. `barMaxWidth` caps the thickness of each bar in drawing units, centring a capped bar or group in its slot. `yStep` puts the value ticks of a vertical chart on multiples of a step, widened when the labels would sit closer than 16 units. `valueFormat: "signed"` writes +12, −5 and 0. All of them are data, so the chart keeps its fit mount.
 * @emits none
 * @states default, horizontal, multiple, stacked, labels, negative, active, per-row, capacity, movement, signed, empty
 * @a11y Apps mount chartFitIsland for a full-width chart; without it the chart still works at its fixed height. The svg is an image named by `title`; every category is one focusable group (tab stop) whose tip and label read all series ("Jan: Desktop 186, Mobile 80"). A sr-only table after the svg lists the same data; it sits in a 1px clipping box, so long names never widen the page at phone width. With more than one series the legend is always shown and `pattern` textures the bars, so colour is never the only signal; negative bars sit below the baseline. A row textured by `patternKey` names the `legendExtra` entry of its pattern in its tip and table row; `categoryLabels` are read in the tip and a "Label" column, and `zeroLabel` in the table caption.
 * @example default: barChart({ title: "Visitors", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }, { m: "May", d: 209 }, { m: "Jun", d: 214 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-a", enter: true })
 * @example horizontal: barChart({ title: "Visitors", orientation: "horizontal", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-b" })
 * @example multiple: barChart({ title: "Visitors by device", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "stripes" }], k: "bar-c" })
 * @example stacked: barChart({ title: "Visitors by device", stacked: true, data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "dots" }], k: "bar-d" })
 * @example labels: barChart({ title: "Visitors", labels: true, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-e" })
 * @example negative: barChart({ title: "Net change", negative: true, data: [{ m: "Jan", v: 186 }, { m: "Feb", v: -205 }, { m: "Mar", v: -207 }, { m: "Apr", v: 173 }], xKey: "m", series: [{ key: "v", label: "Change" }], k: "bar-f" })
 * @example active: barChart({ title: "Visitors", activeIndex: 2, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-g" })
 * @example per-row: barChart({ title: "Browsers", colorKey: "fill", data: [{ b: "Chrome", n: 275, fill: "chart-1" }, { b: "Safari", n: 200, fill: "chart-2" }, { b: "Firefox", n: 187, fill: "chart-3" }], xKey: "b", series: [{ key: "n", label: "Visitors" }], k: "bar-h" })
 * @example capacity: barChart({ title: "Acme arrivals and closures by month", patternKey: "obs", categoryLabels: "net", legendExtra: [{ label: "Not observed, reconstructed or partial", pattern: "stripes" }], axes: { y: true }, data: [{ m: "Jan", a: 30, c: 24, net: "+6", obs: "stripes" }, { m: "Feb", a: 28, c: 31, net: "-3", obs: "stripes" }, { m: "Mar", a: 35, c: 29, net: "+6" }, { m: "Apr", a: 22, c: 27, net: "-5" }, { m: "May", a: 26, c: 26, net: "0" }], xKey: "m", series: [{ key: "a", label: "Arrivals", color: "chart-1" }, { key: "c", label: "Closures", color: "chart-2", pattern: "dots" }], k: "bar-i" })
 * @example movement: barChart({ title: "Acme open count: movement by cause", orientation: "horizontal", negative: true, labels: true, zeroLabel: "Net +7", legendExtra: [{ label: "Added to the open count", color: "chart-1" }, { label: "Removed from it", color: "chart-2" }], data: [{ c: "New findings", v: 24 }, { c: "Reopened", v: 6 }, { c: "Fixed", v: -18 }, { c: "Risk accepted", v: -5 }], xKey: "c", series: [{ key: "v", label: "Change" }], k: "bar-j" })
 * @example signed: barChart({ title: "Acme net change by team", valueFormat: "signed", labels: true, negative: true, zeroLabel: "Net +14", zeroLabelStyle: "pill", barMaxWidth: 32, yStep: 5, axes: { y: true }, data: [{ t: "Core", v: 12 }, { t: "Web", v: -3 }, { t: "Data", v: 0 }, { t: "Ops", v: 7 }, { t: "Docs", v: -2 }], xKey: "t", series: [{ key: "v", label: "Net change" }], legendExtra: [{ label: "Up", color: "chart-1" }, { label: "Down", color: "chart-2" }], k: "bar-k" })
 * @example empty: barChart({ title: "Visitors", data: [], xKey: "m", series: [{ key: "d", label: "Desktop" }] })
 */
export function barChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Bar chart");
  if (!rows.length || !series.length) return emptyView("bar", name, q.emptyText);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const horiz = q.orientation === "horizontal";
  const stacked = !!q.stacked && series.length > 1;
  const multi = series.length > 1;
  const rad = Number.isFinite(q.radius) ? q.radius : horiz ? 5 : multi || stacked ? 4 : 8;
  const n = rows.length;
  const cats = rows.map((r) => catText(q, r[q.xKey]));
  const keys = series.map((s) => s.key);
  const st = stacked ? stackSeries(rows, keys) : null;
  /** @type {Array<Array<{y0: number, y1: number, v: number}>>} */
  const layers = st ? st.layers.map((l) => l.points) : keys.map((key) => stackSeries(rows, [key]).layers[0].points);
  let lo = 0;
  let hi = 0;
  layers.forEach((l) => l.forEach((pt) => { lo = Math.min(lo, pt.y0, pt.y1); hi = Math.max(hi, pt.y0, pt.y1); }));
  const pk = typeof q.patternKey === "string" && q.patternKey ? q.patternKey : "";
  /** The texture a row asks for through `patternKey`, or "" for its series pattern. @param {number} i */
  const rowPat = (i) => { const v = pk ? rows[i][pk] : null; return typeof v === "string" && BAR_PATTERNS.indexOf(v) >= 0 ? v : ""; };
  const extraIn = Array.isArray(q.legendExtra) ? q.legendExtra.filter((e) => e && typeof e === "object" && e.label != null && e.label !== "") : [];
  const extra = extraIn.map((e, i) => ({ label: String(e.label), color: colorVar(e.color || "text-muted", i), pattern: SWATCHES.indexOf(String(e.pattern)) >= 0 ? String(e.pattern) : "none" }));
  /** The legend name of a row's texture, in brackets after its category in tips and the table. @param {number} i */
  const note = (i) => { const rp = rowPat(i); const e = rp ? extra.find((x) => x.pattern === rp) : null; return e ? " (" + e.label + ")" : ""; };
  const cl = q.categoryLabels;
  const catLabels = typeof cl === "function" || (typeof cl === "string" && cl) ? rows.map((r) => { const v = typeof cl === "function" ? cl(r) : r[/** @type {string} */ (cl)]; return v == null ? "" : String(v); }) : null;
  const catW = horiz && catLabels ? Math.max(...catLabels.map((c) => c.length)) * CHAR_PX + 10 : 0;
  const zl = q.zeroLabel != null && q.zeroLabel !== "" ? String(q.zeroLabel) : "";
  // Room for the value labels of bars that run left of zero, between them and the category names.
  const negPad = horiz && q.labels && lo < 0 ? 36 : 0;
  // The category names of a horizontal chart get a column of up to 110 units, or up to 40% of a
  // wider chart; a name that still does not fit is cut with an ellipsis (at its end, or at its
  // start with labelTrim "start", which keeps the end of a path such as org/repo/branch). The tip
  // and the table keep the whole name.
  const askedW = Number(q.width);
  const labelCap = Math.max(110, Math.round((askedW > 0 ? askedW : 600) * 0.4));
  const labelW = horiz && q.axes !== false && !(q.axes && /** @type {any} */ (q.axes).x === false) ? Math.min(labelCap, Math.max(...cats.map((c) => c.length)) * 6.5 + 10) : 0;
  const fitChars = Math.max(4, Math.floor((labelW - 10) / 6.5));
  const fromStart = q.labelTrim === "start";
  /** A category name cut to the label column. @param {string} c */
  const fitName = (c) => (c.length <= fitChars ? c : fromStart ? "\u2026" + c.slice(c.length - fitChars + 1) : c.slice(0, fitChars - 1) + "\u2026");
  const box = horiz
    ? plotBox({ ...q, axes: { x: false, y: false } }, { left: 12 + labelW + negPad, right: (q.labels ? 48 : 12) + catW, top: zl ? 28 : 12, bottom: 8 })
    : plotBox(q, { top: (q.labels ? 28 : 12) + (catLabels ? 16 : 0) });
  const sc = yScaleFor(lo, hi, horiz ? box.l : box.t, horiz ? box.w - box.r : box.h - box.b, false, horiz ? 0 : q.yStep);
  const val = horiz ? linearScale(sc.min, sc.max, box.l, box.w - box.r) : sc.y;
  const band = horiz ? bandScale(n, box.t, box.h - box.b, 0.25) : bandScale(n, box.l, box.w - box.r, 0.2);
  const gap = 4;
  const m = stacked ? 1 : series.length;
  const bw0 = (band.bandwidth - gap * (m - 1)) / m;
  // barMaxWidth caps each bar; a capped group is centred in its slot.
  const cap = num(q.barMaxWidth);
  const bw = cap > 0 && cap < bw0 ? cap : bw0;
  const inset = bw < bw0 ? (bw0 - bw) * m / 2 : 0;
  const zero = val(0);
  // A row texture other than its series' own gets a pattern of its own, one per colour and texture.
  /** @type {import("./chartParts.js").ChartSeries[]} */
  const paints = [];
  /** @param {import("./chartParts.js").ChartSeries} s @param {string} pat */
  const paintFor = (s, pat) => {
    if (pat === s.pattern || pat === "none") return { ...s, pattern: pat };
    let f = paints.find((x) => x.color === s.color && x.pattern === pat);
    if (!f) paints.push(f = { ...s, pattern: pat, index: series.length + paints.length });
    return f;
  };
  /**
   * @param {number} i row
   * @param {import("./chartParts.js").ChartSeries} s
   * @param {{y0: number, y1: number, v: number}} pt
   */
  const barView = (i, s, pt) => {
    const a = val(pt.y0);
    const b = val(pt.y1);
    const len = Math.abs(b - a);
    if (!(len > 0)) return "";
    let paintSeries = s;
    if (q.negative && !multi && pt.v < 0) paintSeries = { ...s, color: colorVar("chart-2", 1), pattern: "none" };
    else if (q.colorKey && !multi && typeof rows[i][q.colorKey] === "string") paintSeries = { ...s, color: colorVar(rows[i][q.colorKey], i) };
    if (rowPat(i)) paintSeries = paintFor(paintSeries, rowPat(i));
    const off = (stacked ? 0 : s.index * (bw + gap));
    const pos = band.start(i) + inset + off;
    const neg = pt.y1 < pt.y0 || (pt.y1 === pt.y0 && pt.v < 0);
    const farIsEnd = !neg;
    let d;
    if (horiz) {
      const x0 = Math.min(a, b);
      /** @type {{tl?: number, tr?: number, bl?: number, br?: number}} */
      const r = {};
      if (farIsEnd) { r.tr = rad; r.br = rad; } else { r.tl = rad; r.bl = rad; }
      if (stacked) { r.tl = r.tr; r.bl = r.br; }
      d = roundRectPath(x0, pos, len, bw, r);
    } else {
      const y0 = Math.min(a, b);
      /** @type {{tl?: number, tr?: number, bl?: number, br?: number}} */
      const r = {};
      if (farIsEnd) { r.tl = rad; r.tr = rad; } else { r.bl = rad; r.br = rad; }
      if (stacked) { r.bl = r.tl; r.br = r.tr; }
      d = roundRectPath(pos, y0, bw, len, r);
    }
    const tip = cats[i] + note(i) + ": " + s.label + " " + fmt(pt.v);
    const cls = "gk-chart__bar" + (horiz ? " is-h" : "") + (neg ? " is-neg" : "") + (q.activeIndex === i ? " is-active" : "");
    const label = q.labels && !stacked
      ? (horiz
        ? html`<text class="gk-chart__value" x="${r2(neg ? Math.min(a, b) - 6 : Math.max(a, b) + 6)}" y="${r2(pos + bw / 2)}" dy="0.32em" text-anchor="${neg ? "end" : "start"}" aria-hidden="true">${fmt(pt.v)}</text>`
        : html`<text class="gk-chart__value" x="${r2(pos + bw / 2)}" y="${r2(neg ? Math.max(a, b) + 16 : Math.min(a, b) - 6)}" text-anchor="middle" aria-hidden="true">${fmt(pt.v)}</text>`)
      : "";
    return html`<path class="${cls}" style="${markStyle(paintSeries, pre)}" d="${d}" data-tip="${tip}"></path>${label}`;
  };
  const targets = rows.map((r, i) => {
    const tip = cats[i] + note(i) + ": " + series.map((s) => s.label + " " + fmt(layers[s.index][i].v)).join(", ") + (catLabels && catLabels[i] ? "; " + catLabels[i] : "");
    const c = band.center(i);
    const cur = horiz
      ? html`<rect class="gk-chart__cursorBand" x="${box.l}" y="${r2(c - band.step / 2)}" width="${box.iw}" height="${r2(band.step)}"></rect>`
      : html`<rect class="gk-chart__cursorBand" x="${r2(c - band.step / 2)}" y="${box.t}" width="${r2(band.step)}" height="${box.ih}"></rect>`;
    const inner = html`${cur}${series.map((s) => barView(i, s, layers[s.index][i]))}`;
    return horiz
      ? categoryTarget({ k, i, tip, x: box.l, y: c - band.step / 2, w: box.iw, h: band.step, inner })
      : categoryTarget({ k, i, tip, x: c - band.step / 2, y: box.t, w: band.step, h: box.ih, inner });
  });
  const yLabels = horiz && labelW
    ? html`<g class="gk-chart__xaxis" aria-hidden="true">${cats.map((c, i) => html`<text class="gk-chart__tick" x="${box.l - 10 - negPad}" y="${r2(band.center(i))}" dy="0.32em" text-anchor="end">${fitName(c)}</text>`)}</g>`
    : "";
  const base = horiz
    ? ""
    : html`${gridView(box, sc.ticks, sc.y, { grid: q.grid !== false, fmt })}${xTicks(box, cats.map((c, i) => ({ x: band.center(i), text: c })))}`;
  // zeroLabelStyle "pill": the zero text in a dark pill (text-token ground, bg-token ink) drawn over the
  // bars, where the plain text sits (above the rule's end, or above a horizontal chart's rule).
  const pill = zl && q.zeroLabelStyle === "pill";
  const pw = zl.length * CHAR_PX + 12;
  const px = Math.max(0, Math.min(box.w - pw, horiz ? zero - pw / 2 : box.w - box.r - pw));
  const cy = horiz ? box.t - 12 : Math.max(9, zero - 11);
  const pillView = pill ? html`<g class="gk-chart__zeroRule" aria-hidden="true"><rect class="gk-chart__zeroPill" x="${r2(px)}" y="${r2(cy - 9)}" width="${pw}" height="18" rx="9"></rect><text class="gk-chart__zeroLabel is-pill" x="${r2(px + pw / 2)}" y="${r2(cy)}" dy="0.32em" text-anchor="middle">${zl}</text></g>` : "";
  const zeroLine = zl
    ? html`<g class="gk-chart__zeroRule" aria-hidden="true">${horiz
      ? html`<line class="gk-chart__zero" x1="${r2(zero)}" x2="${r2(zero)}" y1="${box.t}" y2="${box.h - box.b}"></line>${pill ? "" : html`<text class="gk-chart__zeroLabel" x="${r2(zero)}" y="${box.t - 8}" text-anchor="middle">${zl}</text>`}`
      : html`<line class="gk-chart__zero" x1="${box.l}" x2="${box.w - box.r}" y1="${r2(zero)}" y2="${r2(zero)}"></line>${pill ? "" : html`<text class="gk-chart__zeroLabel" x="${box.w - box.r}" y="${r2(zero - 6)}" text-anchor="end">${zl}</text>`}`}</g>`
    : lo < 0 && !horiz ? html`<line class="gk-chart__zero" x1="${box.l}" x2="${box.w - box.r}" y1="${r2(zero)}" y2="${r2(zero)}" aria-hidden="true"></line>` : "";
  // Category labels: above the highest bar of the group, or in a column right of the plot.
  const catView = catLabels
    ? html`<g class="gk-chart__catLabels" aria-hidden="true">${catLabels.map((c, i) => {
      if (!c) return "";
      if (horiz) return html`<text class="gk-chart__catLabel" x="${box.w - catW + 4}" y="${r2(band.center(i))}" dy="0.32em" text-anchor="start">${c}</text>`;
      const top = Math.min(zero, ...layers.map((l) => Math.min(val(l[i].y0), val(l[i].y1))));
      return html`<text class="gk-chart__catLabel" x="${r2(band.center(i))}" y="${r2(top - 6 - (q.labels && !stacked ? 16 : 0))}" text-anchor="middle">${c}</text>`;
    })}</g>`
    : "";
  const body = html`${base}${zeroLine}${yLabels}${targets}${catView}${pillView}`;
  const table = tableView(zl ? name + " (" + zl + ")" : name, [String(q.xKey || ""), ...series.map((s) => s.label), ...(catLabels ? ["Label"] : [])], rows.map((r, i) => [cats[i] + note(i), ...series.map((s) => fmt(num(layers[s.index][i].v))), ...(catLabels ? [catLabels[i]] : [])]));
  const own = wantLegend(q, series.length);
  const legend = own || extra.length ? legendView([...(own ? series : []), ...extra]) : "";
  return frameView({ q, kind: "bar", view: barChart, vw: box.w, vh: box.h, fit: true, defs: patternDefs(pre, [...series, ...paints]), body, legend, table, name });
}
