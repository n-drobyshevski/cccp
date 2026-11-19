// Extracted from the author's production Apps Script apps; adapted.
// A proportional bar of named categories (severities, registers, owners): each segment's width is
// its share of the total, and its figure and name are printed under it, so the reading never
// depends on colour. Unlike stackBar (statuses, one summary line), the categories are the app's own.
import { attrs, html, styleDecls } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";

/** A colour token name such as "--sev-critical" (the value is the app's own token, never a literal). */
const TOKEN = /^--[a-z][a-z0-9-]*$/;
/** How many chart palette tokens the kit defines (--chart-1 .. --chart-6). */
const PALETTE = 6;

/** The textures a segment may carry, the vocabulary barChart series use. */
const PATTERNS = ["none", "stripes", "dots"];

/**
 * @typedef {{ label: string, value: number, color?: string, note?: string, noteLabel?: string, key: string, pattern: string, tip?: string }} Segment
 * @internal
 */

/**
 * The fill of a segment: its own colour token, else the chart palette by position.
 * @param {unknown} color @param {number} i
 * @internal
 */
export function segmentFill(color, i) {
  return typeof color === "string" && TOKEN.test(color) ? "var(" + color + ")" : "var(--chart-" + ((i % PALETTE) + 1) + ")";
}

/**
 * @component segmentBar
 * @title Segment Bar
 * @category Charts
 * @summary A proportional bar of named categories, each segment's figure and name printed under it; optionally a pressable legend that filters.
 * @param {{segments: Array<{label: string, value: number, color?: string, note?: string, noteLabel?: string, key?: string, pattern?: "none"|"stripes"|"dots", tip?: string}>, label?: string, caption?: string, emptyText?: string, act?: string, pressed?: string[], k?: string}} p
 * `label` names the bar for assistive technology (default "Breakdown"). A segment's width is its share of the total; `color` is the name of a colour token (`"--sev-critical"`), else the segments take the chart palette in order; `pattern` ("stripes" or "dots", the vocabulary barChart series use; default "none") draws a texture over the fill in tokens only, so neighbouring categories differ in shape as well as colour; `note` is short text after the figure (a change such as "▼ 10"); `noteLabel` says it in words ("down 10, 3 percent"): it is the note's tip, and what assistive technology reads in place of the note's glyphs. Segments with a zero, negative or non-numeric value are left out; none left shows `emptyText` (default "No data"). `caption` is a line under the bar ("413 open of 554 tracked.").
 * `act` makes the legend pressable: each entry (figure, note, name, share) is a `<button type="button">` with `data-act` = act, `data-v` = the segment's `key` (default its label), `data-k` = `k` (default "segmentBar") + "-" + key, and `aria-pressed` true when its key is in `pressed`. A segment at 0 stays in a pressable legend (an outlined, empty fill and its words), so the choices never come and go with the counts and a pressed filter can always be released. `tip` is the entry's tip ("Show only Critical."), also sr-only text inside it. The app's delegate handles the act and redraws with the new `pressed`. Without `act` the legend is the plain list.
 * @emits the act you pass (data-v is the segment key, data-k the entry key, aria-pressed its state)
 * @states default, palette, note, patterns, pressable, empty
 * @a11y A labelled group holding a list: each item reads its figure, its note (in the words of `noteLabel` when given), its name and its share of the total ("15 Critical, 4%"); the coloured fills are aria-hidden. Every segment's name is printed under it, and `pattern` textures the fill, so the categories never rest on colour alone; a narrow segment keeps a minimum width so its words stay readable. With `act` each entry is a native toggle button (aria-pressed, a Tab stop in order, Space and Enter press it) whose name is the same words; the pressed one also carries a solid outline and bold name, never colour alone, and the focus ring is 2px var(--accent). Its `tip` shows on hover and focus and is read as sr-only text.
 * @example default: segmentBar({ label: "Open findings by severity", segments: [{ label: "Critical", value: 15, color: "--bad-fg" }, { label: "High", value: 93, color: "--chart-5" }, { label: "Medium", value: 113, color: "--chart-2" }, { label: "Low", value: 138, color: "--info-fg" }, { label: "Info", value: 54, color: "--none-fg" }], caption: "413 open of 554 tracked." })
 * @example palette: segmentBar({ label: "Open findings by register", segments: [{ label: "Dependencies", value: 277 }, { label: "Secrets", value: 106 }, { label: "Code", value: 30 }] })
 * @example note: segmentBar({ label: "Open findings by register", segments: [{ label: "Dependencies", value: 277, note: "-10" }, { label: "Secrets", value: 106, note: "±0" }, { label: "Code", value: 30, note: "▲ 3", noteLabel: "up 3, 11 percent" }] })
 * @example patterns: segmentBar({ label: "Advisories by bucket", segments: [{ label: "Known exploited", value: 12, color: "--chart-1", pattern: "stripes" }, { label: "Public exploit", value: 40, color: "--chart-2", pattern: "dots" }, { label: "Everything else", value: 210, color: "--chart-3" }] })
 * @example pressable: segmentBar({ label: "Advisories by bucket", act: "acme:bucket", k: "acme-bucket", pressed: ["exploit"], segments: [{ label: "Known exploited", key: "kev", value: 12, color: "--chart-1", pattern: "stripes", tip: "Show only known exploited." }, { label: "Public exploit", key: "exploit", value: 40, color: "--chart-2", pattern: "dots", tip: "Showing only public exploit. Press to show all." }, { label: "High EPSS", key: "epss", value: 0, color: "--chart-4" }, { label: "Everything else", key: "rest", value: 210, color: "--chart-3", tip: "Show only everything else." }] })
 * @example empty: segmentBar({ label: "Open findings by severity", segments: [] })
 */
export function segmentBar(p) {
  const q = p || { segments: [] };
  const name = q.label || "Breakdown";
  const act = typeof q.act === "string" && q.act !== "" ? q.act : null;
  const pressed = new Set(act && Array.isArray(q.pressed) ? q.pressed.map(String) : []);
  const kPre = q.k != null && q.k !== "" ? String(q.k) : "segmentBar";
  /** @type {Segment[]} */
  const segs = (Array.isArray(q.segments) ? q.segments : [])
    .filter((s) => s && typeof s.label === "string" && s.label !== "")
    .map((s) => ({
      label: s.label, value: Number(s.value), color: s.color,
      note: typeof s.note === "string" && s.note !== "" ? s.note : undefined,
      noteLabel: typeof s.noteLabel === "string" && s.noteLabel !== "" ? s.noteLabel : undefined,
      key: s.key != null && String(s.key) !== "" ? String(s.key) : s.label,
      pattern: PATTERNS.indexOf(String(s.pattern)) > 0 ? String(s.pattern) : "none",
      tip: typeof s.tip === "string" && s.tip !== "" ? s.tip : undefined,
    }))
    .filter((s) => Number.isFinite(s.value) && (s.value > 0 || (act !== null && s.value === 0)));
  const caption = q.caption ? html`<p class="gk-segmentBar__caption">${q.caption}</p>` : "";
  if (!segs.length) {
    return html`<div class="gk-segmentBar is-empty" role="group" aria-label="${name}"><span class="gk-segmentBar__track" aria-hidden="true"></span><span class="gk-segmentBar__empty">${q.emptyText || "No data"}</span>${caption}</div>`;
  }
  const total = segs.reduce((a, s) => a + s.value, 0);
  /** @param {number} v */
  const share = (v) => {
    const pct = total > 0 ? (v / total) * 100 : 0;
    return (pct > 0 && pct < 1 ? "<1" : String(Math.round(pct))) + "%";
  };
  /** @param {Segment} s */
  const words = (s) => html`<span class="gk-segmentBar__figure"><span class="gk-segmentBar__value">${fmtCount(s.value)}</span>${s.note ? (s.noteLabel ? html` <span class="gk-segmentBar__note" aria-hidden="true" data-tip="${s.noteLabel}">${s.note}</span><span class="sr-only">${s.noteLabel}</span>` : html` <span class="gk-segmentBar__note">${s.note}</span>`) : ""}</span><span class="gk-segmentBar__name">${s.label}</span><span class="sr-only">, ${share(s.value)}</span>`;
  /** @param {Segment} s */
  const entry = (s) => (act
    ? html`<button ${attrs({ type: "button", class: "gk-segmentBar__entry", "aria-pressed": pressed.has(s.key) ? "true" : "false", "data-act": act, "data-v": s.key, "data-k": kPre + "-" + s.key, "data-tip": s.tip || null })}>${words(s)}${s.tip ? html`<span class="sr-only">. ${s.tip}</span>` : ""}</button>`
    : words(s));
  return html`<div class="gk-segmentBar${act ? " is-pressable" : ""}" role="group" aria-label="${name}"><ul class="gk-segmentBar__list">${segs.map(
    (s, i) =>
      html`<li ${attrs({ class: "gk-segmentBar__seg" + (s.pattern !== "none" ? " is-" + s.pattern : "") + (s.value === 0 ? " is-zero" : "") + (pressed.has(s.key) ? " is-pressed" : ""), style: styleDecls({ "--gk-n": s.value, "--gk-fill": segmentFill(s.color, i) }) })}><span class="gk-segmentBar__fill" aria-hidden="true"></span>${entry(s)}</li>`,
  )}</ul>${caption}</div>`;
}
