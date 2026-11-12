// The data-quality sidebar (lx2): the completeness ring, the review state, the Mandatory fields
// checklist and Recently viewed. It collapses to a thin strip; the choice is remembered by the
// page. A field that is filled is ticked and one that is missing is an empty box, with words for a
// screen reader, so the state is never colour alone. Pure.
import { html } from "../../lib/html.js";
import { dots } from "../../components/dots.js";
import { sealView } from "./header.js";

const RING = { bad: "bad", warn: "warn", ok: "ok" };

const ring = (pct, level, small) => html`<span class="ring ${RING[level]}${small ? " mini" : ""}" style="--p:${pct}" role="img" aria-label="${pct + "% complete"}"><b>${small ? "" : pct + "%"}</b></span>`;

/** dq is the model's data-quality part; recent is [{id, name, status}] already resolved. */
export function sidebarView(dq, recent, collapsed) {
  if (collapsed) {
    return html`<aside class="panel dqmini" aria-label="Data quality"><button type="button" class="colb" data-act="side" data-k="fs-side" aria-expanded="false" aria-label="Show data quality" data-tip="Show data quality">«</button>${ring(dq.pct, dq.level, true)}</aside>`;
  }
  return html`<aside class="panel dq lxsb" aria-label="Data quality">
    <div class="dqh"><h3>Data quality</h3><button type="button" class="colb" data-act="side" data-k="fs-side" aria-expanded="true" aria-label="Hide data quality" data-tip="Hide data quality">»</button></div>
    <div class="ringw">${ring(dq.pct, dq.level, false)}<p><b>Completeness</b><br><small>${dq.filled} of ${dq.total} mandatory fields filled</small></p></div>
    <div data-dq="review"><h3>Review</h3>${sealView(dq.review)}<br><small class="mut">${dq.review.tip}</small></div>
    <div data-dq="mandatory"><h3>Mandatory fields</h3>${dq.groups.map((g) => html`<div class="qg"><b>${g.name}</b>${g.items.map((i) => html`<span class="qi ${i.ok ? "y" : ""}" data-field="${i.field}"><i aria-hidden="true"></i>${i.label}<span class="sr-only">${i.ok ? " (filled)" : " (missing)"}</span></span>`)}</div>`)}</div>
    ${recent.length ? html`<div data-dq="recent"><h3>Recently viewed</h3><div class="rec">${recent.map((r) => html`<button type="button" data-act="recent" data-id="${r.id}" data-k="fs-rec-${r.id}"><span class="tbadge" aria-hidden="true"><b>A</b></span><span class="rnm">${r.name}</span>${dots(r.status)}</button>`)}</div></div>` : ""}
  </aside>`;
}
