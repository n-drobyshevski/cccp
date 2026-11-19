// Extracted from the author's production Apps Script apps; adapted.
// A horizontal bar split into labelled bands (ranges or thresholds), with an optional marker for
// a value. The whole bar is one image whose label is the full sentence; each band also prints
// its name and range in a visible key, so the bands are never told apart by colour alone.
import { html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { STATUSES, STATUS_WORDS } from "./statusDot.js";

/**
 * @typedef {{from: number, to: number, label?: string, status?: "ok"|"warn"|"bad"|"info"|"none"}} Band
 */

/** The unit as a suffix: a percent sign hugs the number, any other unit follows a space. @param {string|undefined} u */
function suffix(u) {
  return u ? (u === "%" ? "%" : " " + u) : "";
}

/** @param {number} n */
function num(n) {
  return Number.isInteger(n) ? fmtCount(n) : String(Math.round(n * 100) / 100);
}

/**
 * DOM-free model. Bands outside the scale are clipped to it, empty or reversed bands are
 * dropped, and the value (if finite) is kept as given (only the marker position `pos` is clamped to the scale). `active` is -1 when the value
 * sits in a gap or outside every band. Each band's `start` and `share` are fractions of the scale.
 * @param {{min?: number, max?: number, bands?: Band[], value?: number|null, unit?: string, label?: string}} [p]
 * @returns {{min: number, max: number, bands: Array<{from: number, to: number, start: number, share: number, status: string, name: string, range: string, text: string}>, value: number|null, pos: number|null, active: number, aria: string}}
 * @internal
 */
export function bandBarModel(p) {
  const q = p || {};
  const list = (Array.isArray(q.bands) ? q.bands : []).filter((b) => b && Number.isFinite(Number(b.from)) && Number.isFinite(Number(b.to)));
  const lo = Number.isFinite(Number(q.min)) && q.min != null ? Number(q.min) : list.length ? Math.min(...list.map((b) => Number(b.from))) : 0;
  const hi = Number.isFinite(Number(q.max)) && q.max != null ? Number(q.max) : list.length ? Math.max(...list.map((b) => Number(b.to))) : 0;
  const unit = suffix(q.unit);
  const span = hi - lo;
  const bands = span > 0
    ? list
      .map((b, i) => ({ b, i, from: Math.max(lo, Number(b.from)), to: Math.min(hi, Number(b.to)) }))
      .filter((x) => x.to > x.from)
      .map((x) => {
        const status = x.b.status && STATUSES.indexOf(x.b.status) >= 0 ? x.b.status : "none";
        const name = x.b.label || STATUS_WORDS[/** @type {keyof typeof STATUS_WORDS} */ (status)];
        const range = num(x.from) + " to " + num(x.to) + unit;
        return { from: x.from, to: x.to, start: (x.from - lo) / span, share: (x.to - x.from) / span, status, name, range, text: name + ": " + range };
      })
    : [];
  const v = q.value != null && Number.isFinite(Number(q.value)) && span > 0 ? Number(q.value) : null;
  // Only the marker position is clamped; the real value stays in `value` and in the text.
  const pos = v == null ? null : Math.round(((Math.min(hi, Math.max(lo, v)) - lo) / span) * 1000) / 10;
  const where = v == null ? "" : v > hi ? "above the scale (max " + num(hi) + unit + ")" : v < lo ? "below the scale (min " + num(lo) + unit + ")" : "";
  let active = -1;
  if (v != null) {
    // A value in a gap, or outside every band, is in no band (-1); the scale's top edge belongs to the band that ends there.
    active = bands.findIndex((b) => v >= b.from && (v < b.to || (v === b.to && b.to === hi)));
  }
  const name = q.label || "Bands";
  const aria = bands.length
    ? name + ": " + (v != null ? "value " + num(v) + unit + (where ? ", " + where : active >= 0 ? ", in " + bands[active].name : ", outside the bands") + ". " : "") + "Bands: " + bands.map((b) => b.text).join("; ") + "."
    : name + ": no data.";
  return { min: lo, max: hi, bands, value: v, pos, active, aria };
}

/**
 * @component bandBar
 * @title Band Bar
 * @category Charts
 * @summary A horizontal bar of ranges or thresholds with an optional value marker and a key.
 * @param {{min?: number, max?: number, bands?: Band[], value?: number|null, unit?: string, label?: string, emptyText?: string}} p
 * `bands` are `{from, to, label?, status?}` on one scale (`min` and `max` default to the bands' extent); `value` puts a marker on the scale; `unit` is appended to ranges and the value ("%" directly, any other unit after a space). No usable bands gives the empty state with `emptyText` (default "No data").
 * @emits none
 * @states default, marker, empty
 * @a11y The bar is one image whose label states the value, its band and every band range; the drawn bands are aria-hidden and carry the same figures as a tip. A visible key repeats each band name and range, so status is text, and every status except ok has its own fill pattern. A value in a gap between bands is stated as outside the bands, and one beyond the scale as above or below it with its real figure; the value is also printed under the bar for sighted users. The empty state is announced once (its visible text is aria-hidden).
 * @example default: bandBar({ label: "Patch age", unit: "days", bands: [{ from: 0, to: 30, label: "Fresh", status: "ok" }, { from: 30, to: 90, label: "Ageing", status: "warn" }, { from: 90, to: 365, label: "Stale", status: "bad" }] })
 * @example marker: bandBar({ label: "Coverage", unit: "%", min: 0, max: 100, value: 72, bands: [{ from: 0, to: 50, status: "bad" }, { from: 50, to: 80, status: "warn" }, { from: 80, to: 100, status: "ok" }] })
 * @example empty: bandBar({ bands: [] })
 */
export function bandBar(p) {
  const q = p || {};
  const m = bandBarModel(q);
  if (!m.bands.length) {
    return html`<div class="gk-bandBar is-empty"><div class="gk-bandBar__track" role="img" aria-label="${m.aria}"></div><span class="gk-bandBar__empty" aria-hidden="true">${q.emptyText || "No data"}</span></div>`;
  }
  return html`<div class="gk-bandBar">
<div class="gk-bandBar__bar" role="img" aria-label="${m.aria}"><div class="gk-bandBar__track" aria-hidden="true">${m.bands.map((b, i) => html`<i class="gk-bandBar__seg is-${b.status}${i === m.active ? " is-active" : ""}" style="--gk-from:${Math.round(b.start * 1000) / 10};--gk-n:${Math.round(b.share * 1000) / 10}" data-tip="${b.text}"></i>`)}</div>${m.pos != null ? html`<i class="gk-bandBar__marker" aria-hidden="true" style="--gk-pos:${m.pos}"></i>` : ""}</div>
${m.value != null ? html`<p class="gk-bandBar__value num" aria-hidden="true">${num(m.value)}${suffix(q.unit)}</p>` : ""}
<div class="gk-bandBar__scale" aria-hidden="true"><span class="num">${num(m.min)}</span><span class="num">${num(m.max)}</span></div>
<ul class="gk-bandBar__key">${m.bands.map((b, i) => html`<li class="gk-bandBar__keyItem${i === m.active ? " is-active" : ""}"><i class="gk-bandBar__swatch is-${b.status}" aria-hidden="true"></i><span class="gk-bandBar__name">${b.name}</span> <span class="gk-bandBar__range num">${b.range}</span></li>`)}</ul>
</div>`;
}
