// The fact sheet header (lx2): back button and breadcrumb, the name, the big completeness
// figure, the review seal, Copy link and Open row in sheet, the type badge, lifecycle line and
// tags, the subline and the four pillar status buttons that jump to their section. Pure.
import { html } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";
import { dot } from "../../components/dots.js";
import { tagsView, typeBadge } from "../../components/tags.js";

export const BACK_LABEL = { list: "Applications", heatmap: "Heatmap", landscape: "Landscape", overview: "Overview" };

const LEVEL_CLASS = { bad: "lo", warn: "mid", ok: "" };

export function sealView(seal) {
  const label = seal.label + ". " + seal.tip;
  return html`<span class="seal ${seal.state}" tabindex="0" role="img" aria-label="${label}" data-tip="${seal.tip}">${icon(seal.state === "done" ? "check" : "alert")}${seal.label}</span>`;
}

/** m is a FactSheet header; from is the route Back returns to. */
export function headerView(h, from, sheetEnabled) {
  const back = BACK_LABEL[from] || BACK_LABEL.list;
  const big = h.completeness.pct + "%";
  const bigTip = h.completeness.filled + " of " + h.completeness.total + " mandatory fields filled";
  return html`<div class="top"><button type="button" class="backbtn" data-act="fs-back" data-k="fs-back" aria-label="${"Back to " + back.toLowerCase()}">${icon("arrowleft")}Back</button>
    <nav class="crumbs" aria-label="Breadcrumb"><button type="button" data-act="fs-back" data-k="fs-crumb-back">${back}</button><span aria-hidden="true">/</span><button type="button" data-act="crumb-domain" data-dom="${h.domain}" data-k="fs-crumb-dom">${h.domain}</button><span aria-hidden="true">/</span><span aria-current="page">${h.name}</span></nav></div>
  <div class="hx">
    <div class="r1"><h1>${h.name}</h1><span class="big ${LEVEL_CLASS[h.completeness.level]}" data-fs="pct" tabindex="0" role="img" aria-label="${big + " complete. " + bigTip}" data-tip="${bigTip}">${big}</span>
      <div class="acts">${sealView(h.seal)}
        <button type="button" class="icon-btn" data-act="copy" data-k="fs-copy" aria-label="Copy link" data-tip="Copy link">${icon("link")}</button>
        ${h.sheetLink && sheetEnabled !== false ? html`<a class="icon-btn" data-act="sheet" data-k="fs-sheet" href="${h.sheetLink}" target="_blank" rel="noopener noreferrer" aria-label="Open row in the Sheet. Needs access to the Sheet." data-tip="Open row in the Sheet. Needs access to the Sheet.">${icon("sheet")}</a>` : ""}</div></div>
    <div class="r1">${typeBadge()}<span class="lcline">${icon("check")}Lifecycle: <b>${h.lifecycle ? h.lifecycle.label : html`<span class="mut" aria-hidden="true">—</span><span class="sr-only">Not set</span>`}</b></span>${tagsView(h.tier, h.tags)}</div>
    <div class="r3"><p class="desc">${h.subline}</p>
      <div class="pstat">${h.statuses.map((s) => html`<button type="button" class="stag ${s.status}" data-act="jump" data-sx="${s.section}" data-k="fs-st-${s.section}" data-tip="${s.why}" aria-label="${s.label + ": " + s.word + ". " + s.why + ". Jump to the section"}">${dot(s.status)}${s.label}</button>`)}</div></div>
  </div>`;
}

/** The Fact sheet | People tabs; the count is the people with a name. */
export function tabsView(tab, peopleCount) {
  return html`<div class="ftabs" role="tablist" aria-label="Fact sheet pages"><button type="button" role="tab" data-act="tab" data-v="sheet" data-k="fs-tab-sheet" aria-selected="${tab === "sheet" ? "true" : "false"}">Fact sheet</button><button type="button" role="tab" data-act="tab" data-v="people" data-k="fs-tab-people" aria-selected="${tab === "people" ? "true" : "false"}">People<small>${peopleCount}</small></button></div>`;
}
