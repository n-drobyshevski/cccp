// An island that makes a cartesian chart (areaChart, barChart, lineChart) fill its container at a
// fixed pixel height. The views draw at a static 600 units wide; this island measures the figure,
// and redraws the chart with width set to the pixel width, so the viewBox equals the pixels: the
// 12px text stays 12px, the height stays the height prop, the chart fills the width.
// No library, no listeners besides one ResizeObserver, and no markup of its own: it renders the
// view into the figure through renderRegion.
import { renderRegion } from "@gas-kit/client/dom.js";
import { areaChart } from "./areaChart.js";
import { barChart } from "./barChart.js";
import { lineChart } from "./lineChart.js";

/** @type {Record<string, (p: any) => unknown>} */
const VIEWS = { area: areaChart, bar: barChart, line: lineChart };

/**
 * @component chartFit
 * @title Chart Fit
 * @category Charts
 * @summary Redraws a cartesian chart at the width of its container, so the viewBox equals the pixel width and the 12px text stays 12px.
 * @param {{kind: "area"|"bar"|"line", [prop: string]: any}} p
 * `chartFit(p)` draws the chart `p.kind` with the other props, so a page can write one call; it is the same as calling `areaChart`, `barChart` or `lineChart` directly. The island reads data-props `{kind, props}` from the figure.
 * The views `areaChart`, `barChart` and `lineChart` put data-mount="chartFit" and these props on their figure, so an app only has to mount the island after every render: `mountIslands(root, { chartFit: chartFitIsland })`. On mount and on every resize (ResizeObserver, one redraw per animation frame) it measures the figure and renders the view again with `width` set to the measurement; an unchanged width draws nothing. Charts with a function `valueFormat` or `xFormat` do not carry the mount (functions cannot travel as data) and keep the static width; the names "number", "percent" and "compact" work instead. Polar charts stay square and need no island. Needs chartParts.css and the chart's own CSS.
 * @emits none
 * @states default, line
 * @a11y The redraw keeps the figure, so the focused category (data-k) stays focused and the sr-only table and legend are drawn again with the same text. Without ResizeObserver the chart is measured once. Without JS the chart keeps its fixed height at the static width.
 * @example default: chartFit({ kind: "area", title: "Visitors", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "fit-a" })
 * @example line: chartFit({ kind: "line", title: "Visitors", valueFormat: "compact", data: [{ m: "Jan", d: 1860 }, { m: "Feb", d: 3050 }, { m: "Mar", d: 2370 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], axes: { y: true }, k: "fit-b" })
 */
export function chartFit(p) {
  const { kind, ...rest } = p || {};
  // Own keys only: a prototype name such as "constructor" is an unknown kind.
  /** @type {(props: any) => any} */
  const view = Object.prototype.hasOwnProperty.call(VIEWS, String(kind)) ? /** @type {any} */ (VIEWS)[String(kind)] : areaChart;
  return view(rest);
}

/**
 * Whether the island can redraw a chart of this kind from these props.
 * @internal
 * @param {any} data
 * @returns {boolean}
 */
export function canFit(data) {
  return !!data && typeof data === "object" && typeof data.kind === "string" && Object.prototype.hasOwnProperty.call(VIEWS, data.kind) && !!data.props && typeof data.props === "object";
}

/**
 * The pixel width of a figure, rounded down; 0 when it is hidden or cannot be measured.
 * @internal
 * @param {Element} el
 * @returns {number}
 */
export function measure(el) {
  const a = /** @type {any} */ (el);
  let w = typeof a.getBoundingClientRect === "function" ? Number(a.getBoundingClientRect().width) : 0;
  if (!(w > 0) && typeof a.clientWidth === "number") w = a.clientWidth;
  return Number.isFinite(w) && w > 0 ? Math.floor(w) : 0;
}

/**
 * The island: measures the figure and redraws the chart at that width.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const chartFitIsland = {
  mount(el, data) {
    if (!canFit(data)) return;
    const view = VIEWS[data.kind];
    let last = typeof data.props.width === "number" ? data.props.width : 600;
    let drawn = false;
    let frame = 0;
    /** @type {any} */
    let ro = null;
    let gone = false;
    const draw = () => {
      frame = 0;
      if (gone) return;
      const w = measure(el);
      if (!w || w === last) return;
      last = w;
      // A resize must not replay the entrance, only the first redraw may.
      if (drawn) el.removeAttribute("data-enter");
      drawn = true;
      renderRegion(el, view({ ...data.props, width: w, inner: true, enter: false }), { keepFocus: true, keepScroll: false });
    };
    const schedule = () => {
      if (gone || frame) return;
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
      if (raf) frame = raf(draw);
      else draw();
    };
    schedule();
    const RO = typeof ResizeObserver === "function" ? ResizeObserver : null;
    if (RO) {
      ro = new RO(schedule);
      ro.observe(el);
    }
    return () => {
      gone = true;
      if (ro) ro.disconnect();
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
    };
  },
};
