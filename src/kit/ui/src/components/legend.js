// Extracted from the author's production Apps Script apps; adapted.
// The status legend: one dot with its word per status, optionally a count.
import { html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { statusDot, STATUS_WORDS } from "./statusDot.js";

/** The default legend: every status except info, in the usual order. */
/** @type {Array<{status: "ok"|"warn"|"bad"|"info"|"none", label?: string, count?: number, tip?: string}>} */
const DEFAULT_ITEMS = [{ status: "ok" }, { status: "warn" }, { status: "bad" }, { status: "none" }];

/**
 * @component legend
 * @title Legend
 * @category Charts
 * @summary A list of status dots with their words and optional counts.
 * @param {{items?: Array<{status: "ok"|"warn"|"bad"|"info"|"none", label?: string, count?: number, tip?: string}>, label?: string}} p
 * `items` defaults to ok, warn, bad and none with the default words; an empty array renders nothing.
 * @emits none
 * @states default, counts, empty
 * @a11y A labelled list; each entry is a status word, so the legend never relies on colour. A count follows its word in reading order.
 * @example default: legend({})
 * @example counts: legend({ items: [{ status: "ok", label: "Healthy", count: 1020 }, { status: "bad", label: "Failing", count: 12 }] })
 * @example empty: legend({ items: [] })
 */
export function legend(p) {
  const q = p || {};
  const items = Array.isArray(q.items) ? q.items : DEFAULT_ITEMS;
  if (!items.length) return html``;
  return html`<ul class="gk-legend" role="list" aria-label="${q.label || "Status legend"}">${items.map((it) => {
    const word = it.label != null && it.label !== "" ? it.label : STATUS_WORDS[/** @type {keyof typeof STATUS_WORDS} */ (it.status)];
    return html`<li class="gk-legend__item">${statusDot({ status: it.status, word, tip: it.tip })}${it.count != null ? html`<span class="gk-legend__count num">${fmtCount(it.count)}</span>` : ""}</li>`;
  })}</ul>`;
}
