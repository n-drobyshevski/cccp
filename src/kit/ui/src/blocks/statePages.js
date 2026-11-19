// Page-level blocks composed from shadcn/ui new-york v4 anatomy (MIT; see THIRD_PARTY_NOTICES.md):
// the 404, no-access and error pages, built on the kit's emptyState (icon tile, title, text, action).
import { html, attrs, isSafeUrl } from "@gas-kit/client/html.js";
import { button } from "../components/button.js";
import { emptyState } from "../components/emptyState.js";
import { input } from "../components/input.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/** @param {string[]} paths */
const glyph = (paths) => html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => html`<path d="${d}"></path>`)}</svg>`;
const ICONS = {
  notFound: glyph(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3", "M9 9l4 4", "M13 9l-4 4"]),
  noAccess: glyph(["M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V7a4 4 0 0 1 8 0v4"]),
  error: glyph(["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"]),
};

/**
 * The page frame: one centred emptyState inside a wrapper that can carry extra rows below it.
 * @param {string} kind notFound, noAccess or error
 * @param {any} state emptyState props @param {unknown} extra SafeHtml below the state, or empty
 * @param {unknown} [code] a large eyebrow above the state, or empty
 */
function frame(kind, state, extra, code) {
  return html`<div class="gk-statePage is-${kind}${has(code) ? " has-code" : ""}">${has(code) ? html`<p class="gk-statePage__code" aria-hidden="true">${code}</p>` : ""}${emptyState({ ...state, icon: ICONS[/** @type {keyof typeof ICONS} */ (kind)] })}${has(extra) ? html`<div class="gk-statePage__extra">${extra}</div>` : ""}</div>`;
}

/**
 * @component notFoundPage
 * @title Not Found Page
 * @category Pages
 * @summary The 404 page: an optional large code, a title, a short explanation, an optional search box, a short list of helpful links and buttons home and to support.
 * @param {{title?: string, description?: string, code?: string, links?: Array<{label: string, href: string}>, searchAct?: string, homeHref?: string, supportHref?: string, k?: string}} p
 * `code` is a large eyebrow such as "404" shown in place of the icon tile. `links` is a short row of helpful links (label and href; an entry whose href fails `isSafeUrl` is left out). `title` defaults to "Page not found" and `description` to a line that says the page does not exist. With `searchAct` a search input and a Search button appear; both carry the act, and the app reads the input (data-k "<k>-search") when the button is clicked or the input changes. `homeHref` adds a "Go home" button and `supportHref` a "Contact support" link; a link that fails `isSafeUrl` is left out. `k` prefixes the data-k values (default "notfound"). No island.
 * @emits the `searchAct` you pass (from the Search button and the search input; data-k)
 * @states default, search, links
 * @a11y The state is a section with a heading; the icon is decorative. The search input has the accessible name "Search". Every control is a native button, input or link with a visible name.
 * @example default: notFoundPage({ k: "nf-d", code: "404", description: "The page you are looking for does not exist in Acme Register. It may have moved or been removed.", searchAct: "app:search", links: [{ label: "Overview", href: "#overview" }, { label: "Reports", href: "#reports" }, { label: "Settings", href: "#settings" }], homeHref: "#home", supportHref: "mailto:support@example.org" })
 * @example search: notFoundPage({ k: "nf-s", searchAct: "app:search" })
 * @example links: notFoundPage({ k: "nf-l", homeHref: "#home", supportHref: "https://example.org/support" })
 */
export function notFoundPage(p) {
  const q = p || {};
  const k = has(q.k) ? String(q.k) : "notfound";
  const search = has(q.searchAct)
    ? html`<div class="gk-statePage__search">${input({ type: "search", ariaLabel: "Search", placeholder: "Search", act: String(q.searchAct), k: k + "-search" })}${button({ label: "Search", variant: "secondary", act: String(q.searchAct), k: k + "-search-go" })}</div>`
    : "";
  const links = (Array.isArray(q.links) ? q.links : []).filter((/** @type {any} */ l) => l && typeof l === "object" && has(l.label) && isSafeUrl(l.href));
  const list = links.length
    ? html`<nav class="gk-statePage__links" aria-label="Helpful links"><span class="gk-statePage__linksLabel">Try one of these</span>${links.map((/** @type {any} */ l, /** @type {number} */ i) => button({ label: String(l.label), variant: "outline", size: "sm", href: String(l.href), k: k + "-link-" + (i + 1) }))}</nav>`
    : "";
  const home = isSafeUrl(q.homeHref) ? button({ label: "Go home", href: String(q.homeHref), k: k + "-home" }) : "";
  const support = isSafeUrl(q.supportHref) ? html`<p class="gk-statePage__help">Need help? ${button({ label: "Contact support", variant: "link", href: String(q.supportHref), k: k + "-support" })}</p>` : "";
  return frame("notFound", {
    variant: "empty",
    title: has(q.title) ? q.title : "Page not found",
    body: has(q.description) ? q.description : "The page you are looking for does not exist. It may have moved or been removed.",
  }, has(search) || has(list) || has(home) || has(support) ? html`${search}${list}${home}${support}` : "", q.code);
}

/**
 * @component noAccessPage
 * @title No Access Page
 * @category Pages
 * @summary The no-access page: who can grant access, the account that is signed in and, when given, ways to request access, switch account or reach the owner.
 * @param {{title?: string, description?: string, owner?: string, email?: string, requestAct?: string, switchHref?: string, contactUrl?: string, k?: string}} p
 * `title` defaults to "No access". `description` defaults to a line that names `owner` when it is given ("Ask Acme Support to add you.") and stays generic otherwise; the page never invents a name. `email` adds a line "Signed in as <email>". `requestAct` adds a "Request access" button (data-k "<k>-request") and `switchHref` (a safe link) a "Switch account" link (data-k "<k>-switch"). `contactUrl` (http, https, mailto or relative; anything else is dropped) adds a "Contact the owner" button. `k` prefixes the button's data-k (default "noaccess"). No island.
 * @emits the `requestAct` you pass (data-k "<k>-request")
 * @states default, owner, contact
 * @a11y A status section with a heading; the icon is decorative and the title and text carry the meaning.
 * @example default: noAccessPage({ k: "na-d", owner: "Acme Support", email: "alex@example.org", requestAct: "access:request", switchHref: "#accounts" })
 * @example owner: noAccessPage({ owner: "Acme Support" })
 * @example contact: noAccessPage({ owner: "Acme Support", contactUrl: "mailto:support@example.org", k: "na-c" })
 */
export function noAccessPage(p) {
  const q = p || {};
  const k = has(q.k) ? String(q.k) : "noaccess";
  const owner = has(q.owner) ? String(q.owner) : "";
  const contact = isSafeUrl(q.contactUrl) ? button({ label: "Contact the owner", href: String(q.contactUrl), k: k + "-contact" }) : "";
  const email = has(q.email) ? String(q.email) : "";
  const actions = [];
  if (has(q.requestAct)) actions.push({ act: String(q.requestAct), label: "Request access", k: k + "-request" });
  if (isSafeUrl(q.switchHref)) actions.push({ href: String(q.switchHref), label: "Switch account", variant: /** @type {"outline"} */ ("outline"), k: k + "-switch" });
  return frame("noAccess", {
    variant: "noAccess",
    content: email ? html`<span class="gk-statePage__who">Signed in as <strong>${email}</strong></span>` : null,
    actions: actions.length ? actions : null,
    title: has(q.title) ? q.title : "No access",
    body: has(q.description) ? q.description : owner ? "You do not have access to this app. Ask " + owner + " to add you." : "You do not have access to this app. Ask its owner to add you.",
  }, contact);
}

/**
 * @component errorPage
 * @title Error Page
 * @category Pages
 * @summary The error page: what failed, in the app's words, an optional reference id, Try again and Contact support actions and collapsed technical details.
 * @param {{title?: string, message?: string, retryAct?: string, supportHref?: string, reference?: string, detail?: string, k?: string}} p
 * `title` defaults to "Something went wrong"; `message` is what the app knows (default: a line that asks the reader to try again). `retryAct` adds a "Try again" button with that act. `reference` shows "Error reference: <id>" so a reader can quote it, and `supportHref` (a safe link) adds a "Contact support" button. `detail` goes into a closed "Technical details" disclosure. `k` prefixes the retry button's data-k (default "error-page"). No island.
 * @emits the `retryAct` you pass (data-k "<k>-retry")
 * @states default, retry, detail
 * @a11y The state is role=alert, so the failure is announced when the page appears. The icon is a warning shape, not colour alone, and the title says what happened.
 * @example default: errorPage({ k: "err-x", message: "The register could not be loaded. Your changes are safe; nothing was written.", reference: "ERR-20481", detail: "HTTP 500 from the data source\nGET /register?page=1\nrequest id 7f3a9c", retryAct: "app:retry", supportHref: "mailto:support@example.org" })
 * @example retry: errorPage({ message: "The register could not be loaded.", retryAct: "app:retry", k: "err-r" })
 * @example detail: errorPage({ message: "The register could not be loaded.", detail: "HTTP 500", retryAct: "app:retry", k: "err-d" })
 */
export function errorPage(p) {
  const q = p || {};
  const k = has(q.k) ? String(q.k) : "error-page";
  const actions = [];
  if (has(q.retryAct)) actions.push({ act: String(q.retryAct), label: "Try again", k: k + "-retry" });
  if (isSafeUrl(q.supportHref)) actions.push({ href: String(q.supportHref), label: "Contact support", variant: /** @type {"outline"} */ ("outline"), k: k + "-support" });
  return frame("error", {
    variant: "error",
    title: has(q.title) ? q.title : "Something went wrong",
    body: has(q.message) ? q.message : "Something failed while loading this page. Try again in a moment.",
    content: has(q.reference) ? html`<span class="gk-statePage__ref">Error reference: <code>${q.reference}</code></span>` : null,
    detail: has(q.detail) ? q.detail : null,
    action: !actions.some((x) => x.href) && actions.length ? actions[0] : null,
    actions: actions.some((x) => x.href) ? actions : null,
  }, "");
}
