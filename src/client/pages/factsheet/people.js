// The People tab (lx2 'subscriptions'): one row per role with the person, a Contact action, the
// role and what it is for. A missing person is flagged 'None assigned', never left blank. Pure.
import { html } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";
import { count } from "../../lib/format.js";

const initials = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase() || "?";

export function personView(name) {
  return html`<span class="person"><span class="av" aria-hidden="true">${initials(name)}</span>${name}</span>`;
}

export function peopleView(p) {
  return html`<div class="subs" data-fs="people"><div class="hd"><span>${count(p.count, "person", "people")}</span></div>${p.rows.map((r) => html`<div class="r" data-role="${r.role}"><span>${r.name ? personView(r.name) : html`<span class="res bad">${r.flag}</span>`}</span>${r.name ? html`<button type="button" class="btn sm" data-act="contact" data-name="${r.name}" data-k="fs-contact-${r.role}" data-tip="Copy the name to look the person up">${icon("copy")}Contact</button>` : html`<span></span>`}<b>${r.role}</b><span class="mut">${r.about}</span></div>`)}</div>`;
}
