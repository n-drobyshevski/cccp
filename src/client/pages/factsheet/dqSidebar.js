// The data-quality rail (identity G): a big completeness figure, '8 of 17 mandatory fields', the
// mandatory fields with Missing in red and Filled in green (the words carry the state, never the
// colour alone), the review state and Recently viewed. It collapses to a thin strip; the choice
// is remembered by the page. Pure.
import { html } from "../../lib/html.js";
import { dot } from "../../components/dots.js";
import { sealView } from "./header.js";
import { DQ_TITLE } from "../../../domain/factsheet";
import { PILLARS } from "../../../domain/types";

const RING = { bad: "bad", warn: "warn", ok: "ok" };

const ring = (pct, level) => html`<span class="ring ${RING[level]} mini" style="--p:${pct}" role="img" aria-label="${pct + "% complete"}"><b></b></span>`;

/** dq is the model's data-quality part; recent is [{id, name, status}] already resolved. */
export function sidebarView(dq, recent, collapsed) {
  if (collapsed) {
    return html`<aside class="rail dqmini" aria-label="Data quality"><button type="button" class="colb" data-act="side" data-k="fs-side" aria-expanded="false" aria-label="Show data quality" data-tip="Show data quality">«</button>${ring(dq.pct, dq.level)}</aside>`;
  }
  const tip = dq.filled + " of " + dq.total + " mandatory fields filled";
  return html`<aside class="rail dq lxsb" aria-label="Data quality">
    <div class="dqh"><h3>${DQ_TITLE}</h3><button type="button" class="colb" data-act="side" data-k="fs-side" aria-expanded="true" aria-label="Hide data quality" data-tip="Hide data quality">»</button></div>
    <div class="bigq" data-fs="pct" role="img" aria-label="${dq.pct + "% complete. " + tip}">${dq.pct}%</div>
    <p class="subq">${dq.filled} of ${dq.total} mandatory fields</p>
    <div data-dq="mandatory">${dq.groups.map((g) => html`<div class="qg"><b>${g.name}</b>${g.items.map((i) => html`<div class="qi ${i.ok ? "y" : "x"}" data-field="${i.field}"><span>${i.label}</span><span class="qs">${i.ok ? "Filled" : "Missing"}</span></div>`)}</div>`)}</div>
    <div data-dq="review"><h3>Review</h3>${sealView(dq.review)}<br><small class="mut">${dq.review.tip}</small></div>
    ${recent.length ? html`<div data-dq="recent"><h3>Recently viewed</h3><div class="rec">${recent.map((r) => html`<button type="button" data-act="recent" data-id="${r.id}" data-k="fs-rec-${r.id}"><span class="rnm">${r.name}</span><span class="rdots" aria-hidden="true">${PILLARS.map((p) => dot(r.status[p].status))}</span></button>`)}</div></div>` : ""}
  </aside>`;
}
