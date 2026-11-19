// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

/**
 * @component card
 * @title Card
 * @category Layout
 * @summary A surface with optional header (title, description, action), content and footer slots.
 * @param {{title?: unknown, description?: unknown, action?: unknown, content?: unknown, footer?: unknown, level?: 2|3|4|5|6, k?: string}} p
 * Every slot takes SafeHtml (built with `html`) or plain text, which is escaped; an empty slot renders nothing, and the header renders only when the title, description or action is set. `action` sits at the top right of the header (a button or a badge). `level` is the heading level of the title (default 3), so the page outline stays right.
 * @emits none
 * @states default, with-action, with-footer, content-only
 * @a11y A plain div; the title is a real heading at `level`. The border is decorative, so the card is delimited by its heading and content rather than by the edge alone.
 * @example default: card({ title: "Team plan", description: "Billed yearly", content: "Up to 20 seats and shared dashboards." })
 * @example with-action: card({ title: "Alerts", description: "Sent to the team", action: "Edit", content: "3 rules are active." })
 * @example with-footer: card({ title: "Invoice 1042", content: "Acme Ltd, due on the 30th.", footer: "Last updated today" })
 * @example content-only: card({ content: "Nothing here yet." })
 */
export function card(p) {
  const q = p || {};
  const set = (/** @type {unknown} */ x) => x != null && x !== false && x !== "";
  const lvl = [2, 3, 4, 5, 6].indexOf(/** @type {number} */ (q.level)) >= 0 ? q.level : 3;
  const head = set(q.title) || set(q.description) || set(q.action);
  return html`<div class="gk-card"${set(q.k) ? html` data-k="${q.k}"` : ""}>${head ? html`<div class="gk-card__header${set(q.action) ? " has-action" : ""}">${set(q.title) || set(q.description) ? html`<div class="gk-card__heading">${set(q.title) ? html`<h${lvl} class="gk-card__title">${q.title}</h${lvl}>` : ""}${set(q.description) ? html`<p class="gk-card__description">${q.description}</p>` : ""}</div>` : ""}${set(q.action) ? html`<div class="gk-card__action">${q.action}</div>` : ""}</div>` : ""}${set(q.content) ? html`<div class="gk-card__content">${q.content}</div>` : ""}${set(q.footer) ? html`<div class="gk-card__footer">${q.footer}</div>` : ""}</div>`;
}
