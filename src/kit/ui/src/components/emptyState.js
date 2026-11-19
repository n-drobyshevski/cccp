// Extracted from the author's production Apps Script apps; adapted.
// Empty, error and no-access states. They are separate on purpose: an error is role=alert and
// says what failed, an empty state is role=status and must not read like a failure, and
// no-access says who can fix it. Never invent a date or a number in the copy.
import { attrs, html, isSafe, isSafeUrl } from "@gas-kit/client/html.js";
import { icon as drawIcon, ICON_NAMES } from "@gas-kit/client/icons.js";
import { button } from "./button.js";

/** @type {Record<string, {icon: string, role: string}>} */
const VARIANTS = {
  empty: { icon: "∅", role: "status" },
  error: { icon: "!", role: "alert" },
  noAccess: { icon: "⊘", role: "status" },
};

/**
 * @component emptyState
 * @title Empty State
 * @category Feedback
 * @summary A centred icon, title and body for nothing-to-show, something-failed and no-access, with an optional media tile, actions and a content slot.
 * @param {{variant?: "empty"|"error"|"noAccess", title: string, body?: string|null, icon?: string|null, media?: {icon: string}|unknown, action?: {act: string, label: string, k?: string}|null, actions?: Array<{act?: string, label: string, k?: string, variant?: "default"|"outline"|"ghost", href?: string}>|null, content?: unknown, size?: "default"|"sm", detail?: string|null}} p
 * `icon` is the text glyph and keeps its meaning. `media` replaces it with a soft rounded tile: `{ icon: "search" }` draws a kit icon by name (see ICON_NAMES in the client icons) and ready SafeHtml (an avatar, an illustration) is placed in the tile as given; it must be decorative. `action` is the single outline button and, when `actions` is also given, is shown first. `actions` is a row of kit buttons (`variant` default, outline or ghost; with a safe `href` the button is a link); an entry without an `act` or a safe `href` is left out. `content` is ready SafeHtml under the text, such as a search field or a short list (a plain string is shown as text). `size: "sm"` tightens the spacing for cards and table bodies.
 * @emits the action's own data-act (such as register:retry)
 * @states empty, error, noAccess, withAction, withMedia, withActions, withContent, small
 * @a11y The error variant is role=alert; empty and noAccess are role=status. The icon and media are decorative (aria-hidden); the title carries the meaning, so it is never colour or shape alone. detail sits in a disclosure for technical text. Every action is a native button or link with a visible name.
 * @example empty: emptyState({ variant: "empty", title: "Nothing matches", body: "Try removing a filter." })
 * @example error: emptyState({ variant: "error", title: "Could not load the data", body: "Check your connection and try again.", detail: "HTTP 500" })
 * @example noAccess: emptyState({ variant: "noAccess", title: "No access", body: "Ask an owner to add you." })
 * @example withAction: emptyState({ variant: "empty", title: "No items yet", body: "Add the first one.", action: { act: "items:add", label: "Add item" } })
 * @example withMedia: emptyState({ media: { icon: "users" }, title: "No team members", body: "Invite people to work with you." })
 * @example withActions: emptyState({ media: { icon: "plus" }, title: "No projects yet", body: "Create a project or import one.", actions: [{ act: "projects:new", label: "Create project", k: "es-new" }, { act: "projects:import", label: "Import", variant: "outline", k: "es-import" }, { label: "Read the guide", variant: "ghost", href: "https://example.org/guide", k: "es-guide" }] })
 * @example withContent: emptyState({ media: { icon: "search" }, title: "No results", body: "Nothing in Acme matches that search.", content: "Tip: search by name, owner or id." })
 * @example small: emptyState({ size: "sm", media: { icon: "list" }, title: "No rows", body: "Nothing to show here." })
 */
export function emptyState(p) {
  const want = /** @type {string} */ (p.variant || "empty");
  const v = Object.prototype.hasOwnProperty.call(VARIANTS, want) ? want : "empty";
  const meta = VARIANTS[v];
  const a = p.action;
  const sm = p.size === "sm" ? " is-sm" : "";
  const m = /** @type {any} */ (p.media);
  let lead = html`<span class="gk-empty__icon" aria-hidden="true">${p.icon || meta.icon}</span>`;
  if (m != null && m !== false) {
    if (isSafe(m)) lead = html`<span class="gk-empty__media is-custom" aria-hidden="true">${m}</span>`;
    else if (typeof m === "object" && ICON_NAMES.indexOf(String(m.icon)) >= 0) lead = html`<span class="gk-empty__media" aria-hidden="true">${drawIcon(String(m.icon), 24)}</span>`;
  }
  const extra = (Array.isArray(p.actions) ? p.actions : []).filter((x) => x && (x.act || isSafeUrl(x.href)));
  const one = a ? html`<button type="button" class="gk-empty__action gk-btn" data-variant="outline" ${attrs({ "data-act": a.act, "data-k": a.k || "empty-action" })}>${a.label}</button>` : null;
  const row = extra.length
    ? html`<div class="gk-empty__actions">${one}${extra.map((x, i) => button({ label: x.label, variant: x.variant || "default", act: x.act, href: isSafeUrl(x.href) ? x.href : undefined, k: x.k || "empty-action-" + (i + 1) }))}</div>`
    : one;
  return html`<section class="gk-empty is-${v}${sm}" role="${meta.role}">${lead}<h2 class="gk-empty__title">${p.title}</h2>${
    p.body ? html`<p class="gk-empty__body">${p.body}</p>` : null
  }${p.content != null && p.content !== false && p.content !== "" ? html`<div class="gk-empty__content">${p.content}</div>` : null}${row}${
    p.detail ? html`<details class="gk-empty__detail"><summary data-k="empty-detail">Technical details</summary><pre>${p.detail}</pre></details>` : null
  }</section>`;
}
