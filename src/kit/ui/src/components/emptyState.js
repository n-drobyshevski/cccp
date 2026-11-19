// Extracted from the author's production Apps Script apps; adapted.
// Empty, error and no-access states. They are separate on purpose: an error is role=alert and
// says what failed, an empty state is role=status and must not read like a failure, and
// no-access says who can fix it. Never invent a date or a number in the copy.
import { attrs, html } from "@gas-kit/client/html.js";

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
 * @summary A centred icon, title and body for nothing-to-show, something-failed and no-access, with an optional action.
 * @param {{variant?: "empty"|"error"|"noAccess", title: string, body?: string|null, icon?: string|null, action?: {act: string, label: string, k?: string}|null, detail?: string|null}} p
 * @emits the action's own data-act (such as register:retry)
 * @states empty, error, noAccess, withAction
 * @a11y The error variant is role=alert; empty and noAccess are role=status. The icon is decorative (aria-hidden); the title carries the meaning, so it is never colour or shape alone. detail sits in a disclosure for technical text.
 * @example empty: emptyState({ variant: "empty", title: "Nothing matches", body: "Try removing a filter." })
 * @example error: emptyState({ variant: "error", title: "Could not load the data", body: "Check your connection and try again.", detail: "HTTP 500" })
 * @example noAccess: emptyState({ variant: "noAccess", title: "No access", body: "Ask an owner to add you." })
 * @example withAction: emptyState({ variant: "empty", title: "No items yet", body: "Add the first one.", action: { act: "items:add", label: "Add item" } })
 */
export function emptyState(p) {
  const want = /** @type {string} */ (p.variant || "empty");
  const v = Object.prototype.hasOwnProperty.call(VARIANTS, want) ? want : "empty";
  const meta = VARIANTS[v];
  const a = p.action;
  return html`<section class="gk-empty is-${v}" role="${meta.role}"><span class="gk-empty__icon" aria-hidden="true">${p.icon || meta.icon}</span><h2 class="gk-empty__title">${p.title}</h2>${
    p.body ? html`<p class="gk-empty__body">${p.body}</p>` : null
  }${a ? html`<button type="button" class="gk-empty__action gk-btn" data-variant="outline" ${attrs({ "data-act": a.act, "data-k": a.k || "empty-action" })}>${a.label}</button>` : null}${
    p.detail ? html`<details class="gk-empty__detail"><summary data-k="empty-detail">Technical details</summary><pre>${p.detail}</pre></details>` : null
  }</section>`;
}
