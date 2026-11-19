// Extracted from the author's production Apps Script apps; adapted.
// A help page: a short contents list, titled sections of paragraphs and steps, and a searchable
// glossary. glossaryTip is the small inline term that other pages use: a focusable word with a
// data-tip definition, and the same definition as text for screen readers. The ?term= deep link
// lives in the URL hash (the query string is empty inside an Apps Script frame): read it with
// helpTermFromParams(hashParams()).
import { attrs, html } from "@gas-kit/client/html.js";
import { pluralize } from "@gas-kit/client/format.js";

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {string} s */
const slug = (s) => {
  const t = String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return t || "term";
};

/**
 * The term named by a hash query ({term: "..."}), or "".
 * @param {Record<string, string>|null|undefined} params
 * @returns {string}
 * @internal
 */
export function helpTermFromParams(params) {
  return params && typeof params.term === "string" ? params.term : "";
}

/**
 * Filter glossary entries by a query. Every query word must match the START of a word in the
 * term or its definition, case-insensitively (whole-word-start), so "app" finds "Application"
 * but not "Wrapper". An empty query returns everything.
 * @template {{term: string, definition: string}} T
 * @param {T[]} entries
 * @param {string} q
 * @returns {T[]}
 * @internal
 */
export function searchGlossary(entries, q) {
  const words = String(q || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return (entries || []).slice();
  const res = words.map((w) => new RegExp("(^|[^\\p{L}\\p{N}])" + escapeRegExp(w), "iu"));
  return (entries || []).filter((e) => {
    const hay = e.term + " " + e.definition;
    return res.every((r) => r.test(hay));
  });
}

/**
 * @component glossaryTip
 * @title Glossary Tip
 * @category Domain
 * @summary An inline glossary term: a focusable word that shows its definition on hover and focus.
 * @param {{term: string, tip: string, label?: string, k?: string}} p
 * `label` is the visible text when it differs from the term (for example a plural). `k` is a unique focus key when the same term appears more than once on a page (for example its index); it defaults to a slug of the term, so two tips for one term would share a data-k.
 * @emits none
 * @states default
 * @a11y The word is focusable (tabindex 0) with role=note, so a screen reader announces it as a note rather than nothing, and the tip shows on keyboard focus too. The definition is also in the text for screen readers, so nothing depends on hover.
 * @example glossaryTip({ term: "Owner", tip: "The account that deployed the app and always has full access." })
 */
export function glossaryTip(p) {
  const text = p.label == null ? p.term : p.label;
  return html`<span class="gk-glossaryTip" tabindex="0" ${attrs({ role: "note", "data-tip": p.tip, "data-k": "tip-" + (p.k == null ? slug(p.term) : slug(String(p.k))) })}>${text}<span class="sr-only">, ${p.tip}</span></span>`;
}

/**
 * @component helpPage
 * @title Help Page
 * @category Domain
 * @summary A help page with a contents list, sections of text and steps, and a searchable glossary.
 * @param {{title: string, intro?: string, sections?: Array<{id: string, title: string, paragraphs?: string[], steps?: string[]}>, glossary?: Array<{term: string, definition: string, group?: string}>, query?: string, term?: string, id?: string}} p
 * `query` is the glossary search text; `term` marks one glossary entry as the deep-link target.
 * @emits helpPage:goto (data-section), helpPage:search (input event; read the value), helpPage:clear
 * @states default, searching, noMatches, target
 * @a11y A nav of buttons for the contents; each section is labelled by its heading and has tabindex -1, so the app can move focus to it on helpPage:goto. The glossary is a description list; search has a real label and the result count is a status line. A single glossary group gets no heading. The deep-link target is marked with aria-current and the word "Linked".
 * @example default: helpPage({ title: "Help", intro: "How the register works.", sections: [{ id: "start", title: "Getting started", paragraphs: ["Open the register and pick an item."], steps: ["Search by name.", "Open a row."] }], glossary: [{ term: "Owner", definition: "The account that deployed the app." }, { term: "Admin", definition: "Someone who can edit settings." }] })
 * @example searching: helpPage({ title: "Help", glossary: [{ term: "Owner", definition: "The account that deployed the app." }, { term: "Admin", definition: "Someone who can edit settings." }], query: "own" })
 * @example noMatches: helpPage({ title: "Help", glossary: [{ term: "Owner", definition: "The account that deployed the app." }], query: "zzz" })
 * @example target: helpPage({ title: "Help", glossary: [{ term: "Owner", definition: "The account that deployed the app." }, { term: "Admin", definition: "Someone who can edit settings." }], term: "Admin" })
 */
export function helpPage(p) {
  const id = p.id || "help";
  const sections = p.sections || [];
  const all = p.glossary || [];
  const q = p.query || "";
  const found = searchGlossary(all, q);
  // One id per glossary entry, stable across searches; terms that slug alike get -2, -3, ...
  const taken = new Set();
  const ids = new Map();
  for (const e of all) {
    const base = slug(e.term);
    let n = 1;
    let cand = base;
    while (taken.has(cand)) { n += 1; cand = base + "-" + n; }
    taken.add(cand);
    if (!ids.has(e)) ids.set(e, cand);
  }
  const target = p.term ? p.term.toLowerCase() : "";
  const nav = sections.length > 1 ? html`<nav class="gk-helpPage__nav" aria-label="Contents"><ul>${sections.map((s) => html`<li><button type="button" class="gk-helpPage__navbtn gk-btn" data-variant="outline" data-size="sm" ${attrs({ "data-act": "helpPage:goto", "data-section": s.id, "data-k": "goto-" + s.id })}>${s.title}</button></li>`)}</ul></nav>` : null;
  const secs = sections.map((s) => html`<section class="gk-helpPage__section" id="${id}-${s.id}" tabindex="-1" aria-labelledby="${id}-${s.id}-h"><h2 class="gk-helpPage__h" id="${id}-${s.id}-h">${s.title}</h2>${(s.paragraphs || []).map((t) => html`<p>${t}</p>`)}${s.steps && s.steps.length ? html`<ol>${s.steps.map((t) => html`<li>${t}</li>`)}</ol>` : null}</section>`);
  /** @type {string[]} */
  const groups = [];
  for (const e of found) { const g = e.group || ""; if (groups.indexOf(g) < 0) groups.push(g); }
  const entry = (/** @type {{term: string, definition: string}} */ e) => {
    const on = !!target && e.term.toLowerCase() === target;
    return html`<div class="gk-helpPage__entry${on ? " is-target" : ""}"${on ? html` aria-current="true"` : null} id="${id}-term-${ids.get(e) || slug(e.term)}"><dt class="gk-helpPage__dt">${e.term}${on ? html` <span class="gk-helpPage__linked">Linked</span>` : null}</dt><dd class="gk-helpPage__dd">${e.definition}</dd></div>`;
  };
  const list = groups.map((g) => html`${groups.length > 1 && g ? html`<h3 class="gk-helpPage__gh">${g}</h3>` : null}<dl class="gk-helpPage__dl">${found.filter((e) => (e.group || "") === g).map(entry)}</dl>`);
  const glossary = all.length ? html`<section class="gk-helpPage__section" aria-labelledby="${id}-glossary-h"><h2 class="gk-helpPage__h" id="${id}-glossary-h">Glossary</h2><div class="gk-helpPage__search"><label class="gk-helpPage__label" for="${id}-q">Search the glossary</label><input type="search" class="gk-helpPage__input gk-input" autocomplete="off" ${attrs({ id: id + "-q", value: q, "data-act": "helpPage:search", "data-k": "help-q" })}>${q ? html`<button type="button" class="gk-helpPage__btn gk-btn" data-variant="outline" data-act="helpPage:clear" data-k="help-clear">Clear</button>` : null}</div><p class="gk-helpPage__count" role="status">${q ? found.length + " of " + pluralize(all.length, "term") + " match" : pluralize(all.length, "term")}</p>${
    found.length ? list : html`<p class="gk-helpPage__none">No terms match <strong>${q}</strong>.</p>`
  }</section>` : null;
  return html`<article class="gk-helpPage"><header><h1 class="gk-helpPage__title">${p.title}</h1>${p.intro ? html`<p class="gk-helpPage__intro">${p.intro}</p>` : null}</header>${nav}${secs}${glossary}</article>`;
}
