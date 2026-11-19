// Page-level block composed from shadcn/ui new-york v4 login blocks (MIT; see THIRD_PARTY_NOTICES.md),
// true to Apps Script: the viewer is already signed in with Google, so there is no password field.
import { html, isSafeUrl } from "@gas-kit/client/html.js";
import { button } from "../components/button.js";
import { card } from "../components/card.js";
import { emptyState } from "../components/emptyState.js";
import { field } from "../components/field.js";
import { separator } from "../components/separator.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/**
 * @component accessRequestPage
 * @title Access Request Page
 * @category Pages
 * @summary A sign-in and access request page with no password: continue as the signed-in Google account, or ask the owner for access with a reason, on a muted background that fills the height, with the app mark and name above the card, a footnote under it and an optional side panel.
 * @param {{appName?: string, email?: string, continueAct?: string, switchHref?: string, requestAct?: string, reason?: string, error?: string, sent?: boolean, side?: {title: string, body?: string, author?: string}, k?: string}} p
 * `appName` names the app in the heading (default "this app"). With `email` and `continueAct` a primary "Continue as <email>" button appears, and `switchHref` (a safe link) adds "Use a different account". `requestAct` adds the request form: a "Reason" textarea (data-k "<k>-reason", prefilled from `reason`, with `error` shown under it) and a "Request access" button; the app reads the textarea when the button is clicked. `sent: true` replaces the forms with a confirmation. `side` adds a panel beside the card from 48rem wide, below it when narrower. `k` prefixes the data-k values (default "access"). Complements `noAccessPage`, which only says who to ask; this page lets the reader ask. No island. Needs button.css, card.css, field.css, textarea.css and separator.css.
 * @emits the `continueAct` you pass (data-k "<k>-continue"), the `requestAct` you pass (data-k "<k>-request")
 * @states default, request-only, sent, side-panel, error
 * @a11y The card title is the page heading (h1). The textarea has a visible label and shows its error as text tied to it. The email is plain text in the button label, so it is read aloud. The side panel is an aside with its own heading; it is decorative copy and not needed to act. Layout answers to the block's own width.
 * @example default: accessRequestPage({ k: "ar-a", appName: "Acme Register", email: "dana@example.org", continueAct: "access:continue", switchHref: "#accounts", requestAct: "access:request" })
 * @example request-only: accessRequestPage({ k: "ar-b", appName: "Acme Register", email: "alex@example.org", requestAct: "access:request", reason: "I review Acme Billing each quarter." })
 * @example sent: accessRequestPage({ k: "ar-c", appName: "Acme Register", email: "alex@example.org", sent: true })
 * @example side-panel: accessRequestPage({ k: "ar-d", appName: "Acme Register", email: "dana@example.org", continueAct: "access:continue", requestAct: "access:request", side: { title: "One register for every Acme system", body: "Owners, reviews and findings in one place, read from the source sheet and never written back.", author: "Acme Security team" } })
 * @example error: accessRequestPage({ k: "ar-e", appName: "Acme Register", email: "alex@example.org", requestAct: "access:request", error: "Add a short reason so the owner knows why." })
 */
export function accessRequestPage(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "access";
  const app = has(q.appName) ? String(q.appName) : "this app";
  const email = has(q.email) ? String(q.email) : "";
  const side = q.side && typeof q.side === "object" && has(q.side.title) ? q.side : null;

  const cont = email && has(q.continueAct)
    ? html`<div class="gk-accessRequest__cont">${button({ label: "Continue as " + email, act: String(q.continueAct), k: k + "-continue" })}${isSafeUrl(q.switchHref) ? button({ label: "Use a different account", variant: "ghost", href: String(q.switchHref), k: k + "-switch" }) : ""}</div>`
    : "";
  const request = has(q.requestAct)
    ? html`<div class="gk-accessRequest__form">${field({ label: "Reason", id: k + "-reason", kind: "textarea", required: true, description: "Tell the owner why you need access.", error: has(q.error) ? String(q.error) : undefined, props: { name: "reason", rows: 4, value: has(q.reason) ? String(q.reason) : "", k: k + "-reason" } })}${button({ label: "Request access", variant: cont ? "outline" : "default", act: String(q.requestAct), k: k + "-request" })}</div>`
    : "";
  const body = q.sent === true
    ? emptyState({ size: "sm", media: { icon: "check" }, title: "Request sent", body: "The owners of " + app + " have been told. You will get an email at " + (email || "your account address") + " when they decide." })
    : html`${cont}${cont && request ? html`<div class="gk-accessRequest__or">${separator({})}<span class="gk-accessRequest__orText">or request access</span>${separator({})}</div>` : ""}${request}`;

  const panel = card({
    k: k + "-card", level: 2,
    title: q.sent === true ? undefined : cont ? "Sign in to " + app : "Request access to " + app,
    description: q.sent === true ? undefined : email ? html`Signed in with Google as <strong>${email}</strong>. No password is needed.` : "Sign in with your Google account to continue.",
    content: html`<div class="gk-accessRequest__body">${body}</div>`,
  });
  const brand = has(q.appName) ? html`<div class="gk-accessRequest__brand"><span class="gk-accessRequest__mark" aria-hidden="true"><svg focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg></span><span class="gk-accessRequest__brandName">${app}</span></div>` : "";
  const note = html`<p class="gk-accessRequest__note">Signed in with Google. Your account is used only to check access to ${app}.</p>`;
  return html`<div class="gk-accessRequest${side ? " has-side" : ""}"><div class="gk-accessRequest__main"><div class="gk-accessRequest__panel">${brand}${panel}${note}</div>${side ? html`<aside class="gk-accessRequest__side" aria-labelledby="${k}-side-title"><h2 class="gk-accessRequest__sideTitle" id="${k}-side-title">${side.title}</h2>${has(side.body) ? html`<p class="gk-accessRequest__sideBody">${side.body}</p>` : ""}${has(side.author) ? html`<p class="gk-accessRequest__sideAuthor">${side.author}</p>` : ""}</aside>` : ""}</div></div>`;
}
