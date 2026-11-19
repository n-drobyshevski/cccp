// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

/**
 * @component alert
 * @title Alert
 * @category Feedback
 * @summary An inline message with an icon, a title and a description, default or destructive.
 * @param {{title?: string, description?: unknown, variant?: "default"|"destructive", live?: "alert"|"status"|"none", k?: string}} p
 * `description` takes SafeHtml or text. `variant` destructive swaps the info icon for a warning triangle and tints the text and the border. `live` sets the role: "alert" (assertive, the default for destructive), "status" (polite, the default for default) or "none" for static text that must not be announced.
 * @emits none
 * @states default, destructive
 * @a11y role="alert" or role="status" (or none), so a message inserted by a re-render is announced. The two variants differ by icon shape and the title text as well as colour; the icon is aria-hidden.
 * @example default: alert({ title: "Heads up", description: "Your changes are saved as a draft." })
 * @example destructive: alert({ title: "Could not save", description: "The server refused the change. Try again.", variant: "destructive" })
 */
export function alert(p) {
  const q = p || {};
  const bad = q.variant === "destructive";
  const live = q.live === "alert" || q.live === "status" || q.live === "none" ? q.live : bad ? "alert" : "status";
  const icon = bad
    ? html`<svg class="gk-alert__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20z"></path><path d="M12 10v5"></path><path d="M12 18.5v.01"></path></svg>`
    : html`<svg class="gk-alert__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 7.5v.01"></path></svg>`;
  const hasTitle = q.title != null && q.title !== "";
  const hasDesc = q.description != null && q.description !== "";
  return html`<div class="gk-alert${bad ? " is-destructive" : ""}"${live !== "none" ? html` role="${live}"` : ""}${q.k != null && q.k !== "" ? html` data-k="${q.k}"` : ""}>${icon}${hasTitle ? html`<div class="gk-alert__title">${q.title}</div>` : ""}${hasDesc ? html`<div class="gk-alert__description">${q.description}</div>` : ""}</div>`;
}
