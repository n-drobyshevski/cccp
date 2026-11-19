// Extracted from the author's production Apps Script apps; adapted.
// A headline figure: label, big value, optional note and delta. It is a button when it has an act.
import { attrs, html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { countUp } from "@gas-kit/client/motion.js";

/** What an empty value shows. */
const ABSENT = "—";

/**
 * @param {number} d
 * @returns {"up"|"down"|"flat"}
 */
function direction(d) {
  const r = Math.round(d);
  return r > 0 ? "up" : r < 0 ? "down" : "flat";
}

/**
 * @param {number} d
 * @param {string} [note]
 */
function deltaView(d, note) {
  const dir = direction(d);
  const word = dir === "up" ? "Up" : dir === "down" ? "Down" : "Unchanged";
  const text = dir === "flat" ? word : word + " " + fmtCount(Math.abs(d));
  return html`<span class="gk-kpiTile__delta is-${dir}"><span class="gk-kpiTile__arrow" aria-hidden="true"></span><span>${text}</span>${note ? html` <span class="gk-kpiTile__note">${note}</span>` : ""}</span>`;
}

/**
 * @component kpiTile
 * @title KPI Tile
 * @category Data display
 * @summary A headline number with a label, an optional note and an optional delta.
 * @param {{label: string, value?: number|string|null, note?: string, delta?: number, deltaNote?: string, tip?: string, loading?: boolean, empty?: boolean, countUp?: boolean, act?: string, k?: string, v?: string}} p
 * `delta` is a signed change shown as a word ("Up 3", "Down 2", "Unchanged"); `act` makes the whole tile a button with `data-act`, `k` its `data-k` and `v` its `data-v`; a null, empty or non-finite `value`, or `empty: true`, shows a dash. A number `value` and `delta` are shown as rounded counts (99.5 reads "100"; a delta that rounds to 0 reads "Unchanged"); pass a string to show anything else as is.
 * `countUp: true` (off by default) marks a finite number value with data-mount="kpiCount" so the kpiCountIsland counts it up from 0 on mount; the text is the final, formatted figure from the first render, and a string value is never animated. Mount it with mountIslands(root, { kpiCount: kpiCountIsland }).
 * @emits act (data-v; the act you pass)
 * @states default, delta, loading, empty, counted, interactive
 * @a11y Motion: the loading pulse is a slow fade that stops under reduced motion (the placeholder stays, dashed state is the sr-only "Loading"), the interactive tile eases its background over --dur-2 and presses in slightly, and the optional count-up only rewrites the figure's text (no live region, so a screen reader reads the final figure) and sets it at once under reduced motion. Label and value are read in that order as one run; the delta direction is a word, the arrow is decorative. Loading sets aria-busy and an sr-only "Loading"; empty reads "No data". A tile with a tip is focusable (role="group" named by its label and value, so focus announces both) and the tip is also sr-only text (after the label, separated by a full stop), with no static aria-describedby: tip.js sets that itself on hover and focus, the same pattern as switch and segmented.
 * @example default: kpiTile({ label: "Open items", value: 1042, note: "of 1,234 records" })
 * @example delta: kpiTile({ label: "Open items", value: 42, delta: -3, deltaNote: "since last week" })
 * @example loading: kpiTile({ label: "Open items", loading: true })
 * @example empty: kpiTile({ label: "Open items", value: null })
 * @example counted: kpiTile({ label: "Open items", value: 1042, countUp: true })
 * @example interactive: kpiTile({ label: "Overdue", value: 7, act: "kpi:open", k: "kpi-overdue", v: "overdue", tip: "Show the overdue items" })
 */
export function kpiTile(p) {
  const q = p || { label: "" };
  const isEmpty = !q.loading && (q.empty === true || q.value == null || q.value === "" || (typeof q.value === "number" && !Number.isFinite(q.value)));
  const tip = q.tip != null && q.tip !== "" ? q.tip : null;
  const button = !!q.act && !q.loading;
  let value;
  if (q.loading) value = html`<b class="gk-kpiTile__value is-loading" aria-hidden="true"></b><span class="sr-only">Loading</span>`;
  else if (isEmpty) value = html`<b class="gk-kpiTile__value is-empty" aria-hidden="true">${ABSENT}</b><span class="sr-only">No data</span>`;
  else if (q.countUp === true && typeof q.value === "number") value = html`<b class="gk-kpiTile__value num" ${attrs({ "data-mount": "kpiCount", "data-props": JSON.stringify({ to: q.value }) })}>${fmtCount(q.value)}</b>`;
  else value = html`<b class="gk-kpiTile__value num">${typeof q.value === "number" ? fmtCount(q.value) : q.value}</b>`;
  const body = html`<span class="gk-kpiTile__label">${q.label}</span>${value}${!q.loading && !isEmpty && q.note ? html`<span class="gk-kpiTile__note">${q.note}</span>` : ""}${!q.loading && !isEmpty && typeof q.delta === "number" && Number.isFinite(q.delta) ? deltaView(q.delta, q.deltaNote) : ""}`;
  const cls = "gk-kpiTile" + (q.loading ? " is-loading" : "") + (isEmpty ? " is-empty" : "") + (button ? " is-interactive" : "");
  // The tip text is also real (sr-only) text, so it is never hover-only.
  const tipText = tip ? html`<span class="sr-only">. ${tip}</span>` : "";
  const tipAttrs = tip ? html` data-tip="${tip}"` : "";
  if (button) {
    return html`<button type="button" class="${cls}" data-act="${q.act}"${q.k ? html` data-k="${q.k}"` : ""}${q.v != null ? html` data-v="${q.v}"` : ""}${tipAttrs}>${body}${tipText}</button>`;
  }
  return html`<div class="${cls}"${q.loading ? html` aria-busy="true"` : ""}${tip ? html` role="group" aria-label="${q.label}: ${q.loading ? "Loading" : isEmpty ? "No data" : String(typeof q.value === "number" ? fmtCount(q.value) : q.value)}" tabindex="0" data-tip="${tip}"` : ""}${q.k ? html` data-k="${q.k}"` : ""}>${body}${tipText}</div>`;
}

/**
 * The count-up island, mounted on a kpiTile value that was rendered with countUp: true. It
 * counts from 0 to the value with the client's countUp (final text is exactly fmtCount(to), and
 * it is set at once under reduced motion). Off unless the app registers it.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const kpiCountIsland = {
  mount(el, data) {
    const to = data && typeof data.to === "number" && Number.isFinite(data.to) ? data.to : null;
    if (to === null) return undefined;
    countUp(el, to, { from: 0, format: (n) => fmtCount(Math.round(n)) });
    return undefined;
  },
};
