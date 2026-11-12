// Status glyphs (identity G). One badge per pillar status: OK is a check on a light green tint,
// Attention is "!" on light amber, Gap is a white cross on solid red and No data is an empty dashed
// box. The shape differs per status, so colour is never the only signal; each glyph carries an
// accessible name and a tip with the pillar, the status word and the rule's reason.
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { PILLARS } from "../../domain/types";
import { pillarText } from "./dots.js";

export const PILLAR_CODE = { cyber: "CY", compliance: "CO", continuity: "CT", platform: "PL" };
const MARK = { ok: "check", warn: "bang", bad: "close", none: "" };

/** One glyph for a status ('ok' | 'warn' | 'bad' | 'none') with its accessible text. */
export function glyph(status, text, large) {
  const st = MARK[status] !== undefined ? status : "none";
  return html`<span class="gl ${st}${large ? " lg" : ""}" tabindex="0" role="img" aria-label="${text}" data-tip="${text}">${MARK[st] ? icon(MARK[st]) : ""}</span>`;
}

/** The bare mark, for use inside a control that already has the accessible text. */
export function glyphMark(status, large) {
  const st = MARK[status] !== undefined ? status : "none";
  return html`<span class="gl ${st}${large ? " lg" : ""}" aria-hidden="true">${MARK[st] ? icon(MARK[st]) : ""}</span>`;
}

/** The glyph of one pillar of a status object (a Row's `status`): 'Cyber: Gap. why'. */
export function pillarGlyph(pillar, result, large) {
  const s = result && result.status ? result.status : "none";
  return glyph(s, pillarText(pillar, result), large);
}

/** The four glyphs of a status object in the order CY CO CT PL, as one group. */
export function glyphs(status) {
  return html`<span class="gls" role="group" aria-label="Status by pillar">${PILLARS.map((p) => pillarGlyph(p, status && status[p]))}</span>`;
}
