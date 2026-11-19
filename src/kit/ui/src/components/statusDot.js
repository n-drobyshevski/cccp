// Extracted from the author's production Apps Script apps; adapted.
// A status dot with its word. The status is shown by a shape and a word as well as colour:
// the "none" dot is dashed, "warn" is a rounded square, "bad" a diamond, "info" a ring.
import { html } from "@gas-kit/client/html.js";

/** The five statuses, in display order. */
export const STATUSES = ["ok", "warn", "bad", "info", "none"];

/** The default word for each status; every view takes a `word` prop to say it in your terms. */
export const STATUS_WORDS = { ok: "OK", warn: "Warning", bad: "Problem", info: "Info", none: "No data" };

/**
 * An unknown status falls back to "none" so a bad input never paints a false "ok".
 * @param {unknown} s
 * @returns {string}
 */
function known(s) {
  return typeof s === "string" && STATUSES.indexOf(s) >= 0 ? s : "none";
}

/**
 * @component statusDot
 * @title Status Dot
 * @category Data display
 * @summary A status marker: a shaped dot plus the status word, never colour alone.
 * @param {{status: "ok"|"warn"|"bad"|"info"|"none", word?: string, tip?: string, hideWord?: boolean}} p
 * `word` overrides the default word; `hideWord` keeps the word for screen readers only; `tip`
 * adds a focusable hover and focus tooltip.
 * @emits none
 * @states default, word-hidden, none, tip
 * @a11y The dot is decorative (aria-hidden); the word is real text, visible or sr-only. With a tip the element is focusable so the tip shows on focus too.
 * @example default: statusDot({ status: "ok" })
 * @example word-hidden: statusDot({ status: "warn", hideWord: true })
 * @example none: statusDot({ status: "none", word: "Not assessed" })
 * @example tip: statusDot({ status: "bad", tip: "Backups missing for 3 days" })
 */
export function statusDot(p) {
  const q = p || {};
  const s = known(q.status);
  const word = q.word != null && q.word !== "" ? q.word : STATUS_WORDS[/** @type {keyof typeof STATUS_WORDS} */ (s)];
  const tip = q.tip != null && q.tip !== "" ? q.tip : null;
  // The tip text must also be in visible or aria text: an aria-label of "word. tip" says both.
  const label = tip ? word + ". " + tip : null;
  return html`<span class="gk-statusDot is-${s}"${tip ? html` tabindex="0" role="img" aria-label="${label}" data-tip="${tip}"` : ""}><span class="gk-statusDot__dot" aria-hidden="true"></span><span class="${q.hideWord ? "sr-only" : "gk-statusDot__word"}"${tip ? html` aria-hidden="true"` : ""}>${word}</span></span>`;
}
