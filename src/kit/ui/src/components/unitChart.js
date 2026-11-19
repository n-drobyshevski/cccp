// Extracted from the author's production Apps Script apps; adapted.
// A unit (waffle) chart in pure HTML and CSS: one mark stands for a number of items, marks are
// grouped by status, and the same counts are always in a text table. Colour is never the only
// signal: every status has its own mark fill (solid, hatched, ring, dashed) and a word.
import { html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { STATUSES, STATUS_WORDS } from "./statusDot.js";

/** The most marks a chart draws; a bigger total raises the unit instead. */
export const MAX_MARKS = 40;
/** Round units: the unit is the smallest of these that keeps the chart within MAX_MARKS. */
export const UNITS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 100000, 1000000];

/**
 * @typedef {{status: "ok"|"warn"|"bad"|"info"|"none", count: number, label?: string}} UnitItem
 * @typedef {{status: string, word: string, count: number, marks: number, pct: number}} UnitRow
 */

/**
 * The smallest round unit that fits `total` into `max` marks.
 * @param {number} total
 * @param {number} [max]
 * @returns {number}
 * @internal
 */
export function unitScale(total, max) {
  const cap = max && max > 0 ? max : MAX_MARKS;
  for (const u of UNITS) if (Math.ceil(total / u) <= cap) return u;
  return UNITS[UNITS.length - 1];
}

/**
 * DOM-free model: the rows in status order with their mark counts, the unit and the sentence.
 * Unknown statuses and non-positive or non-numeric counts are dropped; repeated statuses add up.
 * @param {{items?: UnitItem[], unit?: number, noun?: string, label?: string}} [p]
 * @returns {{rows: UnitRow[], total: number, unit: number, marks: number, aria: string}}
 * @internal
 */
export function unitChartModel(p) {
  const q = p || {};
  /** @type {Record<string, {count: number, label?: string}>} */
  const by = {};
  for (const it of Array.isArray(q.items) ? q.items : []) {
    if (!it || STATUSES.indexOf(it.status) < 0) continue;
    const n = Math.round(Number(it.count));
    if (!(n > 0)) continue;
    const cur = by[it.status] || { count: 0, label: undefined };
    cur.count += n;
    if (it.label != null && it.label !== "" && cur.label === undefined) cur.label = it.label;
    by[it.status] = cur;
  }
  const total = STATUSES.reduce((a, s) => a + (by[s] ? by[s].count : 0), 0);
  const given = Number(q.unit);
  // A unit smaller than the scale would need more than MAX_MARKS marks and distort the shares: raise it.
  const unit = given > 0 ? Math.max(1, Math.round(given), unitScale(total)) : unitScale(total);
  /** @type {UnitRow[]} */
  const rows = STATUSES.filter((s) => by[s]).map((s) => ({
    status: s,
    word: by[s].label || STATUS_WORDS[/** @type {keyof typeof STATUS_WORDS} */ (s)],
    count: by[s].count,
    marks: Math.max(1, Math.round(by[s].count / unit)),
    pct: 0,
  }));
  // Shares by largest remainder, so the rows always add up to 100.
  if (total) {
    const exact = rows.map((r) => (r.count / total) * 100);
    rows.forEach((r, i) => { r.pct = Math.floor(exact[i]); });
    let left = 100 - rows.reduce((a, r) => a + r.pct, 0);
    exact.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach((x) => { if (left > 0) { rows[x.i].pct += 1; left -= 1; } });
  }
  // Rounding (at most a few marks) must never exceed the cap: trim the largest row until it fits.
  let marks = rows.reduce((a, r) => a + r.marks, 0);
  while (marks > MAX_MARKS && rows.some((r) => r.marks > 1)) {
    const big = rows.reduce((a, r) => (r.marks > a.marks ? r : a), rows[0]);
    big.marks -= 1;
    marks -= 1;
  }
  const noun = q.noun || "items";
  const aria = rows.length
    ? (q.label || "Counts by status") + ": " + rows.map((r) => fmtCount(r.count) + " " + r.word).join(", ") + ". " + fmtCount(total) + " " + noun + " in total" + (unit > 1 ? ", one mark is " + fmtCount(unit) : "") + "."
    : (q.label || "Counts by status") + ": no data.";
  return { rows, total, unit, marks, aria };
}

/**
 * @component unitChart
 * @title Unit Chart
 * @category Charts
 * @summary A waffle of marks, one per N items, grouped by status, with a key and a text table.
 * @param {{items?: UnitItem[], unit?: number, noun?: string, label?: string, showTable?: boolean, emptyText?: string}} p
 * `items` are status counts (`label` is the word shown for that status); `unit` is how many items one mark stands for (default: the smallest round number that keeps the chart within 40 marks; a smaller value is raised to that, so the marks always keep the true proportions); `noun` names the items ("servers"); `showTable` shows the table instead of keeping it for screen readers. A zero total shows `emptyText` (default "No data").
 * @emits none
 * @states default, scaled, table, empty
 * @a11y The waffle is one image whose label reads every count, the total and the unit; marks and key swatches are aria-hidden. A real table with column and row headers holds the same numbers (screen-reader only unless `showTable`). Status is a fill shape and a word, never colour alone.
 * @example default: unitChart({ items: [{ status: "ok", count: 18 }, { status: "warn", count: 7, label: "Review" }, { status: "bad", count: 3 }, { status: "none", count: 2 }], noun: "servers" })
 * @example scaled: unitChart({ items: [{ status: "ok", count: 1020 }, { status: "bad", count: 105 }], noun: "applications" })
 * @example table: unitChart({ items: [{ status: "ok", count: 4 }, { status: "info", count: 6 }], showTable: true })
 * @example empty: unitChart({ items: [] })
 */
export function unitChart(p) {
  const q = p || {};
  const m = unitChartModel(q);
  const name = q.label || "Counts by status";
  if (!m.rows.length) {
    return html`<figure class="gk-unitChart is-empty" aria-label="${name}"><div class="gk-unitChart__grid" aria-hidden="true"></div><figcaption class="gk-unitChart__empty">${q.emptyText || "No data"}</figcaption></figure>`;
  }
  const marks = [];
  for (const r of m.rows) for (let i = 0; i < r.marks; i++) marks.push(html`<i class="gk-unitChart__mark is-${r.status}"></i>`);
  return html`<figure class="gk-unitChart${m.unit > 1 ? " is-scaled" : ""}" aria-label="${name}">
<div class="gk-unitChart__grid" role="img" aria-label="${m.aria}">${marks}</div>
<ul class="gk-unitChart__key" aria-hidden="true">${m.rows.map((r) => html`<li class="gk-unitChart__keyItem"><i class="gk-unitChart__mark is-${r.status}" aria-hidden="true"></i><span class="gk-unitChart__word">${r.word}</span> <span class="gk-unitChart__n num">${fmtCount(r.count)}</span></li>`)}</ul>
${m.unit > 1 ? html`<p class="gk-unitChart__scale" aria-hidden="true">One mark is ${fmtCount(m.unit)}</p>` : ""}
<table class="${q.showTable ? "gk-unitChart__table" : "gk-unitChart__table sr-only"}"><caption>${name}</caption><thead><tr><th scope="col">Status</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead><tbody>${m.rows.map((r) => html`<tr><th scope="row">${r.word}</th><td class="num">${fmtCount(r.count)}</td><td class="num">${r.pct}%</td></tr>`)}</tbody><tfoot><tr><th scope="row">Total</th><td class="num">${fmtCount(m.total)}</td><td class="num">100%</td></tr></tfoot></table>
</figure>`;
}
