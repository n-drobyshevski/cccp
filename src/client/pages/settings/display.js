// Display tab: which view opens, the default theme, and the two ways to hide applications, each
// with a live count of how many applications it hides now. A pure view.
import { html } from "../../lib/html.js";
import { num, plural } from "../../lib/format.js";
import { switchView } from "../../components/switch.js";
import { isHidden } from "../../state/register.js";

const OPENS = [["overview", "Overview"], ["list", "Inventory"], ["heatmap", "Heatmap"], ["landscape", "Landscape"]];
const THEMES = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];

/** How many of `rows` the draft's hide rules would hide: {prefix, eol}. Each rule on its own. */
export function hideCounts(rows, draft) {
  const prefix = String(draft["display.hidePrefix"] || "");
  let p = 0;
  let e = 0;
  for (const r of rows) {
    if (prefix.trim() !== "" && isHidden(r.app, { hidePrefix: prefix })) p++;
    if (isHidden(r.app, { hideEol: true })) e++;
  }
  return { prefix: p, eol: e };
}

function aff(name, n) {
  return html`<span class="aff" data-cnt="${name}"><b>${num(n)}</b> ${plural(n, "app", "apps")}</span>`;
}

function segs(key, value, options, label) {
  return html`<span class="segs" role="group" aria-label="${label}">${options.map(([v, l]) => html`<button type="button" data-act="s-set" data-key="${key}" data-v="${v}" data-k="seg-${key}-${v}" aria-pressed="${value === v ? "true" : "false"}">${l}</button>`)}</span>`;
}

function sf(label, help, ctrl, forId) {
  return html`<div class="sf"><div class="sfl">${forId ? html`<label for="${forId}"><b>${label}</b></label>` : html`<b>${label}</b>`}${help ? html`<small>${help}</small>` : ""}</div><div class="sfc">${ctrl}</div></div>`;
}

/** ctx: {session, rows}. */
export function displayView(ctx) {
  const d = ctx.session.draft;
  const c = hideCounts(ctx.rows, d);
  const err = ctx.errors["display.hidePrefix"];
  return html`<div class="sgrp">
    ${sf("Opens on", "The view people see when they open CCCP.", segs("display.opensOn", d["display.opensOn"], OPENS, "Opens on"))}
    ${sf("Theme", "People can still switch with the sun icon.", segs("display.theme", d["display.theme"], THEMES, "Theme"))}</div>
    <div class="sgrp"><h3>Hidden applications</h3>
    ${sf("Hide names starting with", "Leftover or test entries. Leave empty to show everything.", html`<input id="st-prefix" class="inp" data-key="display.hidePrefix" data-type="text" data-k="prefix" value="${d["display.hidePrefix"]}" aria-label="Hide names starting with"${err ? html` aria-invalid="true"` : ""}>${aff("hidePrefix", c.prefix)}${err ? html`<small class="errtxt" role="alert">${err}</small>` : ""}`, "st-prefix")}
    ${sf("Hide applications at end of life", "End of life and end of support.", html`${switchView({ key: "display.hideEol", on: d["display.hideEol"] === true, label: "Hide end of life applications" })}${aff("hideEol", c.eol)}`)}</div>`;
}
