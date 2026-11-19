// Extracted from the author's production Apps Script apps; adapted.
// One tick per record over time (scans, runs, backups), each in a named state. A state is a glyph
// and a word as well as a colour: the glyph is drawn on its tick, the legend under the track names
// each glyph in words with its count, and the track is one image named in words. A state with no
// glyph or no word, or two states sharing a glyph, throws: then the ticks would differ by colour.
import { attrs, html, styleDecls } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";

/** A colour token name such as "--chart-2" (the value is a token, never a literal). */
const TOKEN = /^--[a-z][a-z0-9-]*$/;
/** The status tones a state may take. */
const TONES = ["ok", "warn", "bad", "info", "none"];

/**
 * @typedef {{ glyph: string, word: string, tone?: string, color?: string }} TickState
 * @typedef {{ key: string, glyph: string, word: string, tone: string, color: string | null, count: number }} TickRow
 * @internal
 */

/**
 * The states in their given order, checked: each needs a glyph and a word, and no two may share a
 * glyph. Only own keys of `states` are read, so a key such as "constructor" is not a state.
 * @param {unknown} states
 * @returns {TickRow[]}
 * @internal
 */
export function tickStates(states) {
  /** @type {TickRow[]} */
  const out = [];
  if (!states || typeof states !== "object") return out;
  const seen = new Set();
  for (const key of Object.keys(states)) {
    const s = /** @type {any} */ (states)[key];
    if (!s || typeof s !== "object") continue;
    const glyph = typeof s.glyph === "string" ? s.glyph.trim() : "";
    const word = typeof s.word === "string" ? s.word.trim() : "";
    if (!glyph || !word) throw new TypeError("tickTimeline: state " + JSON.stringify(key) + " needs both a glyph and a word");
    if (seen.has(glyph)) throw new TypeError("tickTimeline: state " + JSON.stringify(key) + " shares its glyph with another state");
    seen.add(glyph);
    out.push({
      key,
      glyph,
      word,
      tone: typeof s.tone === "string" && TONES.indexOf(s.tone) >= 0 ? s.tone : "none",
      color: typeof s.color === "string" && TOKEN.test(s.color) ? "var(" + s.color + ")" : null,
      count: 0,
    });
  }
  return out;
}

/**
 * @component tickTimeline
 * @title Tick Timeline
 * @category Charts
 * @summary One tick per record over time, each state a glyph and a word as well as a colour, with a legend and a summary.
 * @param {{ticks: Array<{state?: string}>, states: Record<string, {glyph: string, word: string, tone?: "ok"|"warn"|"bad"|"info"|"none", color?: string}>, label?: string, noun?: string, legend?: boolean | string, plainWord?: string, summary?: string, from?: string, to?: string, emptyText?: string}} p
 * `ticks` are the records in order, each naming its `state`; a tick whose state is not in `states` is plain (a bare tick, no glyph). Each state has a `glyph` drawn on its ticks ("✓") and a `word` ("sealed"), both required (a state missing either, or two states sharing a glyph, throws); `tone` gives a status colour, `color` a colour token (`"--chart-4"`). `label` is the track's spoken reading; without it the counts are said in words ("12 scans: 8 sealed, 3 would seal, 1 unmarked", `noun` default "records"). The legend lists each state's glyph, word and count, and plain ticks as `plainWord` (default "unmarked") when there are any; `legend` as text prints that line instead, and `false` leaves it out. `summary` is a sentence under it. `from` and `to` label the two ends of the track ("Newest", "Oldest"). No ticks shows `emptyText` (default "No records").
 * @emits none
 * @states default, legend, empty
 * @a11y The track is one image named in words, its ticks and glyphs aria-hidden; the legend is a list naming every glyph by its word and count, and the summary is text. Every state draws a glyph as well as a colour and the plain tick draws none, so a state never rests on colour alone.
 * @example default: tickTimeline({ noun: "backups", from: "Newest", to: "Oldest", ticks: [{ state: "pin" }, { state: "pin" }, { state: "pin" }, { state: "pin" }, {}, {}, {}, { state: "due" }, { state: "due" }, { state: "gone" }, { state: "gone" }, { state: "gone" }], states: { pin: { glyph: "•", word: "pinned", tone: "info" }, due: { glyph: "→", word: "would expire", tone: "warn" }, gone: { glyph: "✓", word: "expired", tone: "ok" } }, plainWord: "inside the window", summary: "3 of 12 backups have expired. At 30 days, 2 more would expire on the next pass." })
 * @example legend: tickTimeline({ label: "6 runs: 4 passed, 2 failed", ticks: [{ state: "pass" }, { state: "fail" }, { state: "pass" }, { state: "pass" }, { state: "fail" }, { state: "pass" }], states: { pass: { glyph: "✓", word: "passed", tone: "ok" }, fail: { glyph: "✕", word: "failed", tone: "bad" } }, legend: "✓ passed · ✕ failed, newest first." })
 * @example empty: tickTimeline({ ticks: [], states: { pass: { glyph: "✓", word: "passed" } }, emptyText: "No runs yet." })
 */
export function tickTimeline(p) {
  const q = p || { ticks: [], states: {} };
  const rows = tickStates(q.states);
  /** @type {Map<string, TickRow>} */
  const by = new Map(rows.map((r) => [r.key, r]));
  const ticks = (Array.isArray(q.ticks) ? q.ticks : []).filter((t) => t && typeof t === "object");
  if (!ticks.length) {
    return html`<div class="gk-tickTimeline is-empty"><p class="gk-tickTimeline__empty">${q.emptyText || "No records"}</p></div>`;
  }
  let plain = 0;
  const marks = ticks.map((t) => {
    const s = typeof t.state === "string" ? by.get(t.state) : undefined;
    if (!s) {
      plain += 1;
      return html`<span class="gk-tickTimeline__tick is-plain"></span>`;
    }
    s.count += 1;
    return html`<span ${attrs({ class: "gk-tickTimeline__tick is-" + s.tone, style: s.color ? styleDecls({ "--gk-c": s.color }) : null })}>${s.glyph}</span>`;
  });
  const plainWord = typeof q.plainWord === "string" && q.plainWord !== "" ? q.plainWord : "unmarked";
  const noun = typeof q.noun === "string" && q.noun !== "" ? q.noun : "records";
  const said = rows.filter((r) => r.count > 0).map((r) => fmtCount(r.count) + " " + r.word);
  if (plain) said.push(fmtCount(plain) + " " + plainWord);
  const label = typeof q.label === "string" && q.label !== "" ? q.label : fmtCount(ticks.length) + " " + noun + ": " + said.join(", ");
  const legend = typeof q.legend === "string" && q.legend !== ""
    ? html`<p class="gk-tickTimeline__note">${q.legend}</p>`
    : q.legend === false
      ? ""
      : html`<ul class="gk-tickTimeline__legend">${rows.map((r) => html`<li class="gk-tickTimeline__item"><span ${attrs({ class: "gk-tickTimeline__tick is-key is-" + r.tone, style: r.color ? styleDecls({ "--gk-c": r.color }) : null, "aria-hidden": "true" })}>${r.glyph}</span>${r.word} <span class="gk-tickTimeline__count">${fmtCount(r.count)}</span></li>`)}${plain ? html`<li class="gk-tickTimeline__item"><span class="gk-tickTimeline__tick is-key is-plain" aria-hidden="true"></span>${plainWord} <span class="gk-tickTimeline__count">${fmtCount(plain)}</span></li>` : ""}</ul>`;
  const ends = q.from || q.to
    ? html`<div class="gk-tickTimeline__ends"><span>${q.from || ""}</span>${q.from && q.to ? html`<span class="sr-only"> to </span>` : ""}<span>${q.to || ""}</span></div>`
    : "";
  return html`<div class="gk-tickTimeline"><div class="gk-tickTimeline__span"><div class="gk-tickTimeline__track" role="img" aria-label="${label}"><span class="gk-tickTimeline__ticks" aria-hidden="true">${marks}</span></div>${ends}</div>${legend}${q.summary ? html`<p class="gk-tickTimeline__note">${q.summary}</p>` : ""}</div>`;
}
