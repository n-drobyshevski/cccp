// The right filter panel (820 px and wider; stacked above the results below that). One fieldset
// per pill facet, each with its find box (big facets) and the same checklist the pill popover
// uses, so panel and pills always show the same counts. The open state is kept in 'cccp.side'.
import { html } from "../lib/html.js";
import * as storage from "../lib/storage.js";
import { FACET_BY_KEY } from "../../domain/facets";
import { facetOptions } from "../../domain/query";
import { checklist, findBox } from "./facetList.js";

export const SIDE_KEY = "side";

/** The saved open state: true, false, or null when nothing (or nothing readable) is stored. */
export function readSide() {
  const v = storage.get(SIDE_KEY);
  return v === "1" ? true : v === "0" ? false : null;
}

export function writeSide(open) {
  return storage.set(SIDE_KEY, open ? "1" : "0");
}

/**
 * The panel's markup. `keys` are the facets it lists, `rows` the register rows in scope,
 * `finds` the find text per facet. Empty SafeHtml when the panel is closed.
 */
export function panelView(s, rows, keys, finds) {
  if (!s.side) return html``;
  const filter = { q: s.q, f: s.f };
  return html`<div class="panel side" role="complementary" aria-label="Filter panel">
    <header><b>Filters</b><button type="button" class="linkbtn" data-act="side" data-k="side-hide">Hide</button></header>
    ${keys.map((k) => {
      const def = FACET_BY_KEY[k];
      const options = facetOptions(rows, filter, k);
      const n = (s.f[k] || []).length;
      const find = (finds && finds[k]) || "";
      return html`<fieldset class="fac"><legend class="lbl">${def.label}${n ? " · " + n : ""}</legend>${def.big ? findBox({ key: k, label: def.label, scope: "side", find }) : ""}${checklist({ key: k, options, find, scope: "side" })}</fieldset>`;
    })}
  </div>`;
}
