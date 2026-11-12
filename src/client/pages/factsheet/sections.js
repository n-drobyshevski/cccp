// The Sections page body (lx2): the jump select and Find a field, then Overview and the four
// pillars as collapsible sections, each split into titled subsections. A value that is unknown is
// drawn as a muted dash. Pure views; the page owns the state (closed sections, the find text).
import { html } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";
import { dot } from "../../components/dots.js";
import { lifecycleMark, tierBadge } from "../../components/tags.js";
import { SECTION_KEYS, SECTION_TITLE } from "../../../domain/factsheet";
import { personView } from "./people.js";

const CHEV = () => html`<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><path d="m4.5 2.5 3.5 3.5-3.5 3.5"/></svg>`;

/** The muted dash for an unknown value. */
export const unknown = () => html`<span class="mut" aria-hidden="true">—</span><span class="sr-only">Not set</span>`;

/** One value, by kind. A null value is the dash whatever the kind. */
export function valueView(r) {
  if (r.value === null || r.value === undefined || r.value === "") return unknown();
  switch (r.kind) {
    case "yn": return html`<span class="yn ${r.value === "Yes" ? "yes" : ""} ${r.risk ? "risk" : ""}">${r.value}</span>`;
    case "date": return html`<span class="num">${r.value}</span>${r.age ? html`<span class="age">${r.age}</span>` : ""}`;
    case "res": return html`<span class="res ${r.tone || ""}">${r.value}</span>`;
    case "tier": return tierBadge(r.value);
    case "hours": return html`<span class="num">${r.value} h</span>`;
    case "person": return personView(r.value);
    case "lc": return lifecycleMark({ key: String(r.value), label: String(r.value) });
    default: return String(r.value);
  }
}

export const kvView = (rows) => rows.length ? html`<dl class="kv">${rows.map((r) => html`<dt>${r.label}</dt><dd>${valueView(r)}</dd>`)}</dl>` : "";

function ciatView(w) {
  if (!w.levels) return html`<div class="unset">${dot("none")}Not classified yet</div>`;
  return html`<div class="bars">${w.levels.map((l) => html`<div><span>${l.label}</span>${l.level === null ? html`<b>${unknown()}</b>` : html`<b>${l.level}<small> / 4</small></b>`}<span class="pips" role="img" aria-label="${l.level === null ? l.label + " not set" : l.label + " " + l.level + " of 4"}">${[1, 2, 3, 4].map((x) => html`<i class="${l.level !== null && x <= l.level ? "on" : ""}"></i>`)}</span></div>`)}</div>`;
}

const RTO_MAX = 72;
const rtoWidth = (h) => Math.max(2, Math.min(100, (h / RTO_MAX) * 100));

function rtoView(w) {
  const label = "RTO " + w.rto + " hours" + (w.mtd === null ? "" : ", MTD " + w.mtd + " hours");
  return html`<div class="rto"><span class="cap">Recovery time against max tolerable downtime</span><div class="track" role="img" aria-label="${label}">${w.mtd === null ? "" : html`<i style="width:calc(${rtoWidth(w.mtd)}% - 6px);--c:var(--line2)"></i>`}<i style="width:calc(${rtoWidth(w.rto)}% - 6px)"></i></div><div class="ax" aria-hidden="true"><span>0 h</span><span>24 h</span><span>48 h</span><span>72 h</span></div></div>`;
}

function stepperView(w) {
  return html`<ol class="steps" aria-label="Lifecycle">${w.steps.map((s) => html`<li class="${s.state === "todo" ? "" : s.state === "done" ? "done" : s.state === "end" ? "cur end" : "cur"}"${s.state === "cur" || s.state === "end" ? html` aria-current="step"` : ""}><span data-tip="${s.label}">${s.label}</span></li>`)}</ol>`;
}

function widgetView(w) {
  if (!w) return "";
  return w.type === "ciat" ? html`<div class="ciatw">${ciatView(w)}</div>` : w.type === "rto" ? rtoView(w) : stepperView(w);
}

export const subsectionView = (u) => html`<div class="subsec" data-sub="${u.key}"><h4>${u.title}</h4>${widgetView(u.widget)}${kvView(u.rows)}</div>`;

/** One collapsible section. `open` is decided by the page (its state, or forced by a find). */
export function sectionView(s, open) {
  return html`<details class="fsx" id="sx-${s.key}" data-sx="${s.key}"${open ? html` open` : ""}><summary data-k="fs-sum-${s.key}">${CHEV()}${s.status ? dot(s.status) : ""}<h2>${s.title}</h2>${s.pct !== null ? html`<span class="pct" data-tip="${s.pct + "% of the mandatory fields filled"}">${s.pct}%</span>` : ""}${s.status ? html`<span class="why ${s.status}">${s.why}</span>` : ""}</summary><div class="inner">${s.subsections.map(subsectionView)}</div></details>`;
}

/** The list of sections for a find query. `closed` is the set of collapsed keys. */
export function sectionsView(sections, closed, finding) {
  if (!sections.length) return html`<p class="nomatch mut" role="status">No section or field matches that text.</p>`;
  return html`${sections.map((s) => sectionView(s, finding || !closed.has(s.key)))}`;
}

/** The sticky bar: jump select and Find a field. */
export function barView(find) {
  return html`<div class="sbar"><select class="jump" data-k="fs-jump" aria-label="Jump to section">${SECTION_KEYS.map((k) => html`<option value="${k}">${SECTION_TITLE[k]}</option>`)}</select><label class="search">${icon("search")}<input class="fsearch" type="search" data-k="fs-find" placeholder="Search for sections and fields" value="${find}" aria-label="Find a field"></label></div>`;
}
