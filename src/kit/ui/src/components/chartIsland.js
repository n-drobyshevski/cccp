// Extracted from the author's production Apps Script apps; adapted.
// A Chart.js chart as an island. The view renders a figure with a canvas, a caption and a data
// table that is always in the page for screen readers; the island loads the Chart.js script from
// a URL the app passes in (once per page), draws into the canvas with colours read from the
// --chart-1..n tokens, redraws when the theme changes, honours reduced motion and destroys the
// chart on unmount. If the script cannot be loaded the figure says so and shows the table.
// Chart.js is never a dependency of the kit: the app passes its URL and its integrity value.
// HtmlService cannot serve a script from the app's own origin, so every URL load is a
// cross-origin script with full access to the page: it is refused without a Subresource
// Integrity hash, and is fetched with crossOrigin "anonymous" and no referrer.
import { html } from "@gas-kit/client/html.js";

/** Chart types the view accepts; anything else draws as a bar chart. */
export const CHART_TYPES = ["bar", "line", "pie", "doughnut", "radar", "polarArea"];
const ROUND = ["pie", "doughnut", "polarArea"];
const UNAVAILABLE = "The chart could not be loaded. The data table has the same figures.";
const POINTS = ["circle", "rect", "triangle", "rectRot", "star", "cross"];

/** @param {unknown} v */
const cell = (v) => (v == null || v === "" || (typeof v === "number" && !Number.isFinite(v)) ? "–" : String(v));

/** A short stable hash for a default id. @param {string} str */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * The props the island reads, as plain JSON, cleaned.
 * @param {any} p
 * @returns {{url: string, integrity: string, type: string, labels: string[], series: Array<{label: string, data: Array<number|null>}>, label: string, unavailable: string}}
 * @internal
 */
export function chartProps(p) {
  const q = p || {};
  const labels = (Array.isArray(q.labels) ? q.labels : []).map((/** @type {any} */ l) => (l == null ? "" : String(l)));
  const series = (Array.isArray(q.series) ? q.series : []).filter((/** @type {any} */ s) => s && Array.isArray(s.data)).map((/** @type {any} */ s, /** @type {number} */ i) => ({
    label: s.label != null && s.label !== "" ? String(s.label) : "Series " + (i + 1),
    data: labels.map((/** @type {string} */ _, /** @type {number} */ k) => (s.data[k] != null && Number.isFinite(Number(s.data[k])) ? Number(s.data[k]) : null)),
  }));
  return { url: typeof q.url === "string" ? q.url : "", integrity: typeof q.integrity === "string" ? q.integrity.trim() : "", type: CHART_TYPES.indexOf(q.type) >= 0 ? q.type : "bar", labels, series, label: q.label != null ? String(q.label) : q.caption != null ? String(q.caption) : "", unavailable: q.unavailable != null ? String(q.unavailable) : "" };
}

/**
 * @component chartIsland
 * @title Chart Island
 * @category Charts
 * @summary A Chart.js chart (island) with a caption and an always-present data table.
 * @param {{id?: string, url: string, integrity?: string, type?: "bar"|"line"|"pie"|"doughnut"|"radar"|"polarArea", labels?: string[], series?: Array<{label?: string, data: Array<number|null>}>, caption?: string, showTable?: boolean, unavailableText?: string, emptyText?: string}} p
 * `url` is the Chart.js script URL, built by the app with the join idiom; `integrity` is its Subresource Integrity value ("sha384-" and the base64 digest, as the CDN publishes it), required for a URL load: without it the script is not fetched and the figure shows the table (a page that already defines a global `Chart` needs neither). The script is fetched with crossOrigin "anonymous" (the host must send CORS headers) and no referrer; `labels` and `series` are the data (one value per label per series); `id` must be unique on the page (characters other than letters, digits, underscore and hyphen become a hyphen): it names the figure and the table id (default: "chart-" plus a hash of the data, so two different charts differ, but give charts that share data an `id`); `showTable` shows the table as well as the chart. No labels or no series gives the empty state with no island.
 * @emits none
 * @states default, line, table, empty
 * @a11y The canvas is an image named by the caption and pointed at the data table with aria-details. The table (caption, column and row headers) is always in the page and is only visually hidden until `showTable` or until the chart cannot load; the status line is an empty live region from the start and the island fills it with the explanation, so it is announced. On the canvas, line series differ by point and dash shapes, but bars and pie or doughnut slices differ by colour only, so the data table (series by column, labels by row) is the non-colour channel for them.
 * @example default: chartIsland({ url: ["https:", "", "example.org", "chart.umd.js"].join("/"), integrity: "sha384-AcmeExampleDigestOnlyAcmeExampleDigestOnlyAcmeExampleDigestOnly0", caption: "Open items by month", labels: ["Jan", "Feb", "Mar"], series: [{ label: "Opened", data: [12, 18, 9] }, { label: "Closed", data: [10, 14, 15] }] })
 * @example line: chartIsland({ id: "trend", url: ["https:", "", "example.org", "chart.umd.js"].join("/"), type: "line", caption: "Trend", labels: ["Q1", "Q2"], series: [{ label: "Score", data: [61, 70] }] })
 * @example table: chartIsland({ url: ["https:", "", "example.org", "chart.umd.js"].join("/"), caption: "Share by team", type: "doughnut", labels: ["Red", "Blue"], series: [{ label: "Share", data: [30, 70] }], showTable: true })
 * @example empty: chartIsland({ url: ["https:", "", "example.org", "chart.umd.js"].join("/"), caption: "Open items", labels: [], series: [] })
 */
export function chartIsland(p) {
  const q = p || {};
  const c = chartProps(q);
  const id = (q.id ? String(q.id).replace(/[^A-Za-z0-9_-]/g, "-") : "") || "chart-" + hash(JSON.stringify([c.type, c.label, c.labels, c.series]));
  const name = c.label || "Chart";
  if (!c.labels.length || !c.series.length) {
    return html`<figure class="gk-chartIsland is-empty"><figcaption class="gk-chartIsland__caption">${name}</figcaption><p class="gk-chartIsland__empty">${q.emptyText || "No data"}</p></figure>`;
  }
  const tableId = id + "-data";
  const props = JSON.stringify({ url: c.url, integrity: c.integrity, type: c.type, labels: c.labels, series: c.series, label: name, unavailable: q.unavailableText || UNAVAILABLE });
  return html`<figure class="gk-chartIsland${q.showTable ? " is-table" : ""}" id="${id}" data-mount="chartIsland" data-props="${props}">
<figcaption class="gk-chartIsland__caption">${name}</figcaption>
<div class="gk-chartIsland__box"><canvas class="gk-chartIsland__canvas" role="img" aria-label="${name}" aria-details="${tableId}"></canvas></div>
<p class="gk-chartIsland__unavailable" role="status"></p>
<table class="gk-chartIsland__table" id="${tableId}"><caption>${name}</caption><thead><tr><td></td>${c.series.map((s) => html`<th scope="col">${s.label}</th>`)}</tr></thead><tbody>${c.labels.map((l, i) => html`<tr><th scope="row">${l}</th>${c.series.map((s) => html`<td class="num">${cell(s.data[i])}</td>`)}</tr>`)}</tbody></table>
</figure>`;
}

/** In-flight script loads by url, shared by every island on the page. @type {Map<string, Promise<any>>} */
const pending = new Map();

/** One or more SRI hashes: sha256, sha384 or sha512, a dash and a base64 digest. */
const SRI = /^(sha256|sha384|sha512)-[A-Za-z0-9+\/]+={0,2}(\s+(sha256|sha384|sha512)-[A-Za-z0-9+\/]+={0,2})*$/;

/**
 * The default loader: the global Chart if the page already has it, else a script element with
 * the given https URL and integrity value (required), crossOrigin "anonymous" and no referrer.
 * Resolves with the Chart constructor.
 * @param {string} url
 * @param {string} [integrity]
 * @returns {Promise<any>}
 * @internal
 */
export function loadChartScript(url, integrity) {
  const g = /** @type {any} */ (globalThis);
  if (typeof g.Chart === "function") return Promise.resolve(g.Chart);
  if (typeof url !== "string" || !/^https:/i.test(url)) return Promise.reject(new Error("chartIsland: the script URL must be https"));
  if (typeof integrity !== "string" || !SRI.test(integrity.trim())) return Promise.reject(new Error("chartIsland: a script loaded by URL needs an integrity value (sha384- and the digest)"));
  const key = url + " " + integrity.trim();
  const known = pending.get(key);
  if (known) return known;
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.onload = () => (typeof g.Chart === "function" ? resolve(g.Chart) : reject(new Error("chartIsland: no Chart global after load")));
    s.onerror = () => { s.remove(); reject(new Error("chartIsland: the script was blocked or failed")); };
    s.integrity = integrity.trim();
    s.crossOrigin = "anonymous";
    s.referrerPolicy = "no-referrer";
    s.src = url;
    document.head.appendChild(s);
  });
  pending.set(key, p);
  // A failure is forgotten so a later mount can retry.
  p.catch(() => { pending.delete(key); });
  return p;
}

/** Read a CSS custom property from the root element. @param {string} name */
function rootStyle(name) {
  return String(globalThis.getComputedStyle(document.documentElement).getPropertyValue(name) || "").trim();
}

/** Call `cb` when the colour scheme or the data-theme attribute changes; returns the unsubscribe. @param {() => void} cb */
function watchThemeDefault(cb) {
  /** @type {Array<() => void>} */
  const offs = [];
  try {
    const mq = globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) { mq.addEventListener("change", cb); offs.push(() => mq.removeEventListener("change", cb)); }
  } catch (e) { /* no media query support */ }
  try {
    if (typeof MutationObserver === "function") {
      const mo = new MutationObserver(cb);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      offs.push(() => mo.disconnect());
    }
  } catch (e) { /* no observer support */ }
  return () => offs.forEach((f) => f());
}

function reducedMotionDefault() {
  try { return !!(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
}

/**
 * Build the Chart.js config. `colors` are the resolved --chart-N values (may be empty).
 * @param {ReturnType<typeof chartProps>} c
 * @param {{colors: string[], text: string, grid: string, reduced: boolean}} t
 * @internal
 */
export function chartConfig(c, t) {
  const round = ROUND.indexOf(c.type) >= 0;
  const col = (/** @type {number} */ i) => (t.colors.length ? t.colors[i % t.colors.length] : undefined);
  const datasets = c.series.map((s, i) => round
    ? { label: s.label, data: s.data, backgroundColor: c.labels.map((_, k) => col(k)), borderWidth: 1 }
    : { label: s.label, data: s.data, backgroundColor: col(i), borderColor: col(i), pointStyle: POINTS[i % POINTS.length], borderDash: c.type === "line" && i % 2 ? [6, 4] : [], borderWidth: c.type === "line" ? 2 : 0 });
  /** @type {any} */
  const options = { responsive: true, maintainAspectRatio: false, animation: t.reduced ? false : undefined, color: t.text, plugins: { legend: { labels: { color: t.text, usePointStyle: true } } } };
  if (c.type === "radar") {
    options.scales = { r: { ticks: { color: t.text, backdropColor: "transparent" }, grid: { color: t.grid }, angleLines: { color: t.grid }, pointLabels: { color: t.text } } };
  }
  if (!round && c.type !== "radar") {
    options.scales = { x: { ticks: { color: t.text }, grid: { color: t.grid } }, y: { ticks: { color: t.text }, grid: { color: t.grid } } };
  }
  return { type: c.type, data: { labels: c.labels, datasets }, options };
}

/**
 * Make the island. Every dependency is injectable for tests: `load(url, integrity)` returns the Chart
 * constructor, `getStyle(name)` reads a CSS custom property, `watchTheme(cb)` returns an
 * unsubscribe, `reducedMotion()` says whether to skip animation. The loader runs once per url
 * for the life of the island object while it works; a failed load is forgotten, so the next mount retries.
 * @param {{load?: (url: string, integrity: string) => Promise<any>, getStyle?: (name: string) => string, watchTheme?: (cb: () => void) => () => void, reducedMotion?: () => boolean}} [deps]
 * @returns {import("@gas-kit/client/islands.js").Island}
 * @internal
 */
export function createChartIsland(deps) {
  const d = deps || {};
  const load = d.load || loadChartScript;
  const getStyle = d.getStyle || rootStyle;
  const watchTheme = d.watchTheme || watchThemeDefault;
  const reducedMotion = d.reducedMotion || reducedMotionDefault;
  /** @type {Map<string, Promise<any>>} */
  const loads = new Map();
  /** @param {string} url @param {string} integrity */
  const loadOnce = (url, integrity) => {
    const key = url + " " + integrity;
    let p = loads.get(key);
    if (!p) {
      p = Promise.resolve().then(() => load(url, integrity));
      loads.set(key, p);
      p.catch(() => { if (loads.get(key) === p) loads.delete(key); });
    }
    return p;
  };
  return {
    mount(el, data) {
      const c = chartProps(data);
      const canvas = el.querySelector("canvas");
      let disposed = false;
      /** @type {any} */
      let chart = null;
      /** @type {(() => void) | null} */
      let unwatch = null;
      const destroy = () => { if (chart) { try { chart.destroy(); } catch (e) { /* already gone */ } chart = null; } };
      /** @param {any} Chart */
      const draw = (Chart) => {
        destroy();
        const colors = [];
        for (let i = 1; i <= 12; i++) { const v = getStyle("--chart-" + i); if (!v) break; colors.push(v); }
        chart = new Chart(canvas, chartConfig(c, { colors, text: getStyle("--text-muted"), grid: getStyle("--border"), reduced: reducedMotion() }));
      };
      loadOnce(c.url, c.integrity).then((Chart) => {
        if (disposed) return;
        draw(Chart);
        el.setAttribute("data-chart", "ready");
        unwatch = watchTheme(() => { if (!disposed) { try { draw(Chart); } catch (e) { /* keep the old chart state */ } } });
      }).catch(() => {
        if (disposed) return;
        destroy();
        el.classList.add("is-unavailable");
        el.setAttribute("data-chart", "unavailable");
        const note = el.querySelector(".gk-chartIsland__unavailable");
        if (note) note.textContent = c.unavailable || UNAVAILABLE;
      });
      return () => {
        disposed = true;
        if (unwatch) unwatch();
        unwatch = null;
        destroy();
        el.removeAttribute("data-chart");
        el.classList.remove("is-unavailable");
        const note = el.querySelector(".gk-chartIsland__unavailable");
        if (note) note.textContent = "";
      };
    },
  };
}

/** The island the app registers as `chartIsland` in `mountIslands(root, { chartIsland: chartIslandDef })`. */
export const chartIslandDef = createChartIsland();
