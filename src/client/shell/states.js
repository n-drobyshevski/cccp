// The cards that stand in for a page: loading skeleton, no access, error with Retry, empty,
// no source yet, admins only. Each is a pure function returning SafeHtml.
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";

const MAILTO = /^mailto:[^\s<>"']+$/i;

function card(kind, glyph, title, body, extra) {
  return html`<section class="state ${kind}" role="${kind === "error" ? "alert" : "status"}">
    <span class="state-ico">${icon(glyph, 22)}</span>
    <h1>${title}</h1>
    ${body ? html`<p>${body}</p>` : ""}
    ${extra || ""}
  </section>`;
}

/** Loading placeholder shaped like a page: a heading line and a block of rows. */
export function skeleton(label) {
  const rows = [0, 1, 2, 3, 4, 5].map(() => html`<i class="sk-row"></i>`);
  return html`<section class="state skel" aria-busy="true" aria-live="polite">
    <span class="sr-only">${label || "Loading the register"}</span>
    <i class="sk-line w40"></i><i class="sk-line w70"></i>
    <div class="sk-block">${rows}</div>
  </section>`;
}

/** The viewer has no access: the sentence from the server and a mailto to the owner. */
export function accessCard(o) {
  const x = o || {};
  const ask = x.contact && MAILTO.test(x.contactUrl || "")
    ? html`<p class="state-act"><a class="btn primary" href="${x.contactUrl}">Contact ${x.contact}</a></p>`
    : "";
  return card("denied", "lock", "You do not have access", x.message || "Your account is not on the list for this register.", ask);
}

export function errorState(o) {
  const x = o || {};
  return card("error", "alert", x.title || "Something went wrong", x.message || "The register could not be loaded.",
    html`<p class="state-act"><button type="button" class="btn" data-act="retry" data-k="retry">Retry</button></p>`);
}

export function emptyState(o) {
  const x = o || {};
  const act = x.action ? html`<p class="state-act"><button type="button" class="btn" data-act="${x.action.act}" data-k="empty-act">${x.action.label}</button></p>` : "";
  return card("empty", "info", x.title || "Nothing to show", x.body || "", act);
}

/** No register Sheet is connected. The owner gets the way to connect one. */
export function noSource(o) {
  const owner = !!(o && o.owner);
  return card("nosource", "sheet", "No register connected yet",
    owner ? "Connect the Google Sheet that holds your application register to get started." : "The owner has not connected the register Sheet yet. Ask them to finish the setup.",
    owner ? html`<p class="state-act"><button type="button" class="btn primary" data-act="connect" data-k="connect">Connect a sheet</button></p>` : "");
}

export function onlyAdmins() {
  return card("denied", "lock", "Only admins can change settings", "Ask an admin of this register if something needs to change.");
}

export function notFound(what) {
  return card("empty", "info", (what || "That page") + " was not found", "The link may be old, or the application may have been removed from the register.",
    html`<p class="state-act"><button type="button" class="btn" data-act="home" data-k="home">Back to the register</button></p>`);
}
