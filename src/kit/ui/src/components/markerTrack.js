// Extracted from the author's production Apps Script apps; adapted.
// Rows of shaped markers on one shared axis: a target tick, a median dot, a bound band, a
// reference diamond, each row with its name, a spoken reading of its track and figure cells
// beside it. bandBar draws one bar of ranges and the cartesian charts draw series; this puts
// several marks per row on one scale (often logarithmic), the caller placing them. Every mark
// kind has its own shape, named in the key, so the reading never rests on colour.
import { attrs, html, cssValue } from "@gas-kit/client/html.js";

/** A colour token name such as "--chart-2" (the value is a token, never a literal). */
const TOKEN = /^--[a-z][a-z0-9-]*$/;

/**
 * The shapes a marker may take; each has its own outline, so no two differ by colour alone.
 * @internal
 */
export const MARKER_SHAPES = ["tick", "dot", "ring", "diamond", "band"];

/** The status tones a marker may take, each a status token. */
const TONES = /** @type {Record<string, string>} */ ({ ok: "--ok-fg", warn: "--warn-fg", bad: "--bad-fg", info: "--info-fg", none: "--none-fg" });

/** The colour a shape takes when the marker names none. */
const SHAPE_COLOR = /** @type {Record<string, string>} */ ({ tick: "--text", dot: "--chart-1", ring: "--chart-1", diamond: "--chart-2", band: "--chart-1" });

/**
 * @typedef {{ pos: number, shape?: string, to?: number, tone?: string, color?: string }} Marker
 * @typedef {{ head?: unknown, label: string, marks?: Marker[], cells?: unknown[] }} TrackRow
 * @internal
 */

/**
 * A position as a percentage of the track (0..100, two decimals), or null when it is not a number.
 * @param {unknown} v
 * @returns {number | null}
 * @internal
 */
export function markerPos(v) {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n)) * 100) / 100 : null;
}

/**
 * Where a value sits on a scale from `min` to `max`, as a percentage of the track: linear, or
 * logarithmic with `log: true` (then min, max and the value must be above zero). Values outside
 * the scale are clamped to its ends; null when the value or the scale cannot be read.
 * @param {unknown} value
 * @param {{ min: number, max: number, log?: boolean }} scale
 * @returns {number | null}
 * @internal
 */
export function markerScale(value, scale) {
  const v = typeof value === "number" ? value : NaN;
  const lo = Number(scale && scale.min);
  const hi = Number(scale && scale.max);
  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  if (scale.log) {
    if (lo <= 0 || v <= 0) return null;
    return markerPos(((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100);
  }
  return markerPos(((v - lo) / (hi - lo)) * 100);
}

/**
 * The fill of a marker: its own colour token, else its tone's status token, else its shape's.
 * @param {{ tone?: string, color?: string }} m @param {string} shape
 * @internal
 */
export function markerColor(m, shape) {
  if (typeof m.color === "string" && TOKEN.test(m.color)) return "var(" + m.color + ")";
  if (typeof m.tone === "string" && Object.prototype.hasOwnProperty.call(TONES, m.tone)) return "var(" + TONES[m.tone] + ")";
  return "var(" + SHAPE_COLOR[shape] + ")";
}

/** @param {unknown} s */
const shapeOf = (s) => (typeof s === "string" && MARKER_SHAPES.indexOf(s) >= 0 ? s : "dot");

/** @param {Marker} m */
function mark(m) {
  const shape = shapeOf(m.shape);
  const pos = markerPos(m.pos);
  if (pos === null) return "";
  const c = cssValue(markerColor(m, shape));
  if (shape === "band") {
    const end = markerPos(m.to);
    const a = end === null ? pos : Math.min(pos, end);
    const b = end === null ? pos : Math.max(pos, end);
    return html`<span class="gk-markerTrack__mark is-band" style="--gk-pos:${a};--gk-to:${b};--gk-c:${c}"></span>`;
  }
  return html`<span class="${"gk-markerTrack__mark is-" + shape}" style="--gk-pos:${pos};--gk-c:${c}"></span>`;
}

/**
 * @param {TrackRow} r @param {number} i
 */
function track(r, i) {
  const name = typeof r.label === "string" && r.label !== "" ? r.label : typeof r.head === "string" && r.head !== "" ? r.head : "Row " + (i + 1);
  return html`<span class="gk-markerTrack__track" role="img" aria-label="${name}">${(Array.isArray(r.marks) ? r.marks : []).filter((m) => m && typeof m === "object").map(mark)}</span>`;
}

/**
 * @param {unknown} axis
 */
function axisRow(axis) {
  const ticks = (Array.isArray(axis) ? axis : []).filter((t) => t && markerPos(t.pos) !== null && t.label != null && t.label !== "");
  return ticks.map((t) => {
    const pos = /** @type {number} */ (markerPos(t.pos));
    const cls = "gk-markerTrack__tick" + (pos === 0 ? " is-start" : pos === 100 ? " is-end" : "") + (t.minor ? " is-minor" : "");
    return html`<span class="${cls}" style="--gk-pos:${pos}">${t.label}</span>`;
  });
}

/**
 * @component markerTrack
 * @title Marker Track
 * @category Charts
 * @summary Rows of shaped markers (tick, dot, ring, diamond, band) on one shared axis, each row with a head, a spoken reading and figure cells.
 * @param {{rows: Array<{head?: unknown, label: string, marks?: Array<{pos: number, shape?: "tick"|"dot"|"ring"|"diamond"|"band", to?: number, tone?: "ok"|"warn"|"bad"|"info"|"none", color?: string}>, cells?: unknown[]}>, label?: string, axis?: Array<{pos: number, label: string, minor?: boolean}>, axisLabel?: string, headLabel?: string, columns?: string[], key?: Array<{shape: "tick"|"dot"|"ring"|"diamond"|"band", label: string, tone?: "ok"|"warn"|"bad"|"info"|"none", color?: string}>, note?: string, compact?: boolean, emptyText?: string}} p
 * `label` names the figure for assistive technology (default "Markers"). A marker's `pos` (and a band's `to`) is a percentage of the track, placed by the caller for its own scale (`markerScale(value, {min, max, log})` does linear and log); a marker with no readable position is left out. `shape` defaults to `"dot"`; `tone` gives a status colour, `color` names a colour token (`"--chart-4"`), else the shape keeps its own colour. A row's `label` is the spoken reading of its track, the figures in words ("High: median 41 days, against a 14-day target"); `head` names the row (text or `html`), and `cells` are its figures under `columns`. `axis` labels the scale above the tracks (`minor` ticks hide on a narrow screen; `axisLabel`, default "Scale", is its column's spoken header). `key` names each shape in words and `note` is a line after it ("Log scale."). `compact` draws the tracks alone, without heads, cells or columns: one bounded figure under its number. No rows shows `emptyText` (default "No data").
 * @emits none
 * @states default, band, compact, empty
 * @a11y A labelled group holding a table: each row's head is its row header, its track one image named by the row's `label`, and its cells text under their column headers; the axis is aria-hidden behind a spoken column header. Every marker kind has its own shape, named in words in the key, and a tone only repeats in colour what the row's label and cells say, so the reading never rests on colour.
 * @example default: markerTrack({ label: "Time to fix against the target, by severity", axis: [{ pos: 0, label: "1d" }, { pos: 30, label: "7d", minor: true }, { pos: 58, label: "30d" }, { pos: 100, label: "1y" }], columns: ["Median", "Open"], rows: [{ head: "Critical", label: "Critical: median 5 days, against a 7-day target; open items' median age 3 days", marks: [{ pos: 30, shape: "tick" }, { pos: 18, shape: "diamond" }, { pos: 25, shape: "dot", tone: "ok" }], cells: ["5 d, inside target", "4"] }, { head: "High", label: "High: median 41 days, against a 14-day target; open items' median age 60 days", marks: [{ pos: 41, shape: "tick" }, { pos: 63, shape: "diamond" }, { pos: 58, shape: "dot", tone: "bad" }], cells: ["41 d, past target", "93"] }, { head: "Medium", label: "Medium: at least 90 days, against a 30-day target", marks: [{ pos: 58, shape: "tick" }, { pos: 76, shape: "ring" }], cells: ["90+ d, past target", "113"] }], key: [{ shape: "tick", label: "Target" }, { shape: "dot", label: "Median time to fix" }, { shape: "ring", label: "At least (never fell to half)" }, { shape: "diamond", label: "Median age of what is open" }], note: "Log scale: a week and a year both stay legible." })
 * @example band: markerTrack({ label: "Share fixed in time", axis: [{ pos: 0, label: "0%" }, { pos: 50, label: "50%" }, { pos: 100, label: "100%" }], columns: ["Rate"], rows: [{ head: "Acme Web", label: "Acme Web: 62% fixed in time, bounds 55% to 70%, against a 50% reference", marks: [{ pos: 55, to: 70, shape: "band" }, { pos: 62, shape: "dot" }, { pos: 50, shape: "tick" }], cells: ["62%"] }, { head: "Acme API", label: "Acme API: 38% fixed in time, bounds 30% to 41%, against a 50% reference", marks: [{ pos: 30, to: 41, shape: "band" }, { pos: 38, shape: "dot" }, { pos: 50, shape: "tick" }], cells: ["38%"] }], key: [{ shape: "dot", label: "Rate" }, { shape: "band", label: "Bounds" }, { shape: "tick", label: "Reference" }] })
 * @example compact: markerTrack({ compact: true, rows: [{ label: "62% fixed in time, bounds 55% to 70%, against a 50% reference", marks: [{ pos: 55, to: 70, shape: "band" }, { pos: 62, shape: "dot" }, { pos: 50, shape: "tick" }] }] })
 * @example empty: markerTrack({ label: "Time to fix against the target", rows: [], emptyText: "Nothing in scope." })
 */
export function markerTrack(p) {
  const q = p || { rows: [] };
  const name = typeof q.label === "string" && q.label !== "" ? q.label : "Markers";
  /** @type {TrackRow[]} */
  const rows = (Array.isArray(q.rows) ? q.rows : []).filter((r) => r && typeof r === "object");
  const keyItems = (Array.isArray(q.key) ? q.key : []).filter((k) => k && typeof k.label === "string" && k.label !== "");
  const note = typeof q.note === "string" && q.note !== "" ? html`<span class="gk-markerTrack__note">${q.note}</span>` : "";
  const key = keyItems.length || note
    ? html`<div class="gk-markerTrack__foot">${keyItems.length ? html`<ul class="gk-markerTrack__key">${keyItems.map((k) => {
      const shape = shapeOf(k.shape);
      return html`<li class="gk-markerTrack__keyItem"><span class="gk-markerTrack__swatch" aria-hidden="true"><span class="${"gk-markerTrack__mark is-key is-" + shape}" style="--gk-c:${cssValue(markerColor(k, shape))}"></span></span>${k.label}</li>`;
    })}</ul>` : ""}${note}</div>`
    : "";
  if (!rows.length) {
    return html`<div class="gk-markerTrack is-empty" role="group" aria-label="${name}"><p class="gk-markerTrack__empty">${q.emptyText || "No data"}</p></div>`;
  }
  const ticks = axisRow(q.axis);
  if (q.compact) {
    const group = typeof q.label === "string" && q.label !== "" ? attrs({ role: "group", "aria-label": q.label }) : "";
    return html`<div class="gk-markerTrack is-compact" ${group}>${ticks.length ? html`<span class="gk-markerTrack__axis" aria-hidden="true">${ticks}</span>` : ""}${rows.map(track)}${key}</div>`;
  }
  const cols = (Array.isArray(q.columns) ? q.columns : []).map((c) => (c == null ? "" : c));
  const width = Math.max(cols.length, ...rows.map((r) => (Array.isArray(r.cells) ? r.cells.length : 0)));
  const heads = rows.some((r) => r.head != null && r.head !== "");
  const thead = ticks.length || cols.length
    ? html`<thead><tr>${heads ? (q.headLabel ? html`<th scope="col" class="gk-markerTrack__colhead">${q.headLabel}</th>` : html`<td></td>`) : ""}<th scope="col" class="gk-markerTrack__axiscell"><span class="gk-markerTrack__axis" aria-hidden="true">${ticks}</span><span class="sr-only">${q.axisLabel || "Scale"}</span></th>${Array.from({ length: width }, (_, i) => html`<th scope="col" class="gk-markerTrack__colhead is-num">${cols[i] || ""}</th>`)}</tr></thead>`
    : "";
  const body = rows.map((r, i) => {
    const cells = Array.isArray(r.cells) ? r.cells : [];
    return html`<tr>${heads ? html`<th scope="row" class="gk-markerTrack__head">${r.head == null ? "" : r.head}</th>` : ""}<td class="gk-markerTrack__trackcell">${track(r, i)}</td>${Array.from({ length: width }, (_, j) => html`<td class="gk-markerTrack__cell">${cells[j] == null ? "" : cells[j]}</td>`)}</tr>`;
  });
  return html`<div class="gk-markerTrack" role="group" aria-label="${name}"><table class="gk-markerTrack__table">${thead}<tbody>${body}</tbody></table>${key}</div>`;
}
