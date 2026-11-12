// The fact sheet header (identity G): breadcrumb, the large name with the review seal and its
// link actions, one meta line (tier, lifecycle, typology, hosting, owner), the exposure tags and
// the four-pillar scorecard whose cells jump to their section. Pure.
import { html } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";
import { glyphMark } from "../../components/glyph.js";
import { tagsView, tierBadge } from "../../components/tags.js";

export const BACK_LABEL = { list: "Inventory", overview: "Overview" };

export function sealView(seal) {
  const label = seal.label + ". " + seal.tip;
  return html`<span class="seal ${seal.state}" tabindex="0" role="img" aria-label="${label}" data-tip="${seal.tip}">${icon(seal.state === "done" ? "check" : "alert")}${seal.label}</span>`;
}

const SEP = () => html`<span class="sep" aria-hidden="true">·</span>`;

/** The meta line: 'No tier · General availability · Cloud · owned by Person 0307'. */
export function metaView(h) {
  const hosting = h.tags.find((t) => t.key === "h");
  const typology = h.tags.find((t) => t.key === "ty");
  const parts = [
    tierBadge(h.tier),
    h.lifecycle ? html`<b>${h.lifecycle.label}</b>` : html`<span class="mut">Lifecycle not set</span>`,
    typology ? html`<span>${typology.label}</span>` : "",
    hosting ? html`<span>${hosting.label}</span>` : "",
    h.owner ? html`<span>owned by <b>${h.owner}</b></span>` : html`<span class="mut">no owner</span>`,
  ].filter((p) => p !== "");
  return html`<p class="meta" data-fs="meta">${parts.map((p, i) => html`${i ? SEP() : ""}${p}`)}</p>`;
}

/** The scorecard: one cell per pillar with its glyph, status word and reason. */
export function scorecardView(statuses) {
  return html`<div class="score" role="group" aria-label="Status by pillar">${statuses.map((s) => html`<button type="button" class="sc pc-${s.pillar}" data-act="jump" data-sx="${s.section}" data-k="fs-st-${s.section}" data-tip="${s.why}" aria-label="${s.label + ": " + s.word + ". " + s.why + ". Jump to the section"}"><span class="k">${s.label}</span><span class="v">${glyphMark(s.status, true)}<b>${s.word}</b></span><span class="w">${s.why}</span></button>`)}</div>`;
}

/** h is a FactSheet header; from is the route Back returns to. */
export function headerView(h, from, sheetEnabled) {
  const back = BACK_LABEL[from] || BACK_LABEL.list;
  return html`<div class="hx">
    <nav class="crumbs" aria-label="Breadcrumb"><button type="button" data-act="fs-back" data-k="fs-crumb-back" aria-label="${"Back to " + back.toLowerCase()}">${back}</button><span aria-hidden="true">›</span><button type="button" data-act="crumb-domain" data-dom="${h.domain}" data-k="fs-crumb-dom">${h.domain}</button>${h.subdomain ? html`<span aria-hidden="true">›</span><span>${h.subdomain}</span>` : ""}</nav>
    <div class="r1"><h1 tabindex="-1" data-k="fs-title">${h.name}</h1>
      <div class="acts">${sealView(h.seal)}
        <button type="button" class="icon-btn" data-act="copy" data-k="fs-copy" aria-label="Copy link" data-tip="Copy link">${icon("link")}</button>
        ${h.sheetLink && sheetEnabled !== false ? html`<a class="icon-btn" data-act="sheet" data-k="fs-sheet" href="${h.sheetLink}" target="_blank" rel="noopener noreferrer" aria-label="Open row in the Sheet. Needs access to the Sheet." data-tip="Open row in the Sheet. Needs access to the Sheet.">${icon("sheet")}</a>` : ""}</div></div>
    ${metaView(h)}
    ${tagsView(h.tags)}
    ${scorecardView(h.statuses)}
  </div>`;
}

/** The Fact sheet | People tabs; the count is the people with a name. */
export function tabsView(tab, peopleCount) {
  return html`<div class="ftabs" role="tablist" aria-label="Fact sheet pages"><button type="button" role="tab" id="fs-tab-sheet" aria-controls="fs-panel" tabindex="${tab === "sheet" ? "0" : "-1"}" data-act="tab" data-v="sheet" data-k="fs-tab-sheet" aria-selected="${tab === "sheet" ? "true" : "false"}">Fact sheet</button><button type="button" role="tab" id="fs-tab-people" aria-controls="fs-panel" tabindex="${tab === "people" ? "0" : "-1"}" data-act="tab" data-v="people" data-k="fs-tab-people" aria-selected="${tab === "people" ? "true" : "false"}">People<small>${peopleCount}</small></button></div>`;
}
