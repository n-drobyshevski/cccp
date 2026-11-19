// Extracted from the author's production Apps Script apps; adapted.
// The sticky save bar of an editable form: unsaved changes, saving, saved, conflict, error.
import { html } from "@gas-kit/client/html.js";
import { pluralize } from "@gas-kit/client/format.js";

const STATES = ["dirty", "saving", "saved", "conflict", "error"];

/**
 * @component savebar
 * @title Save Bar
 * @category Feedback
 * @summary A sticky bar that shows save progress and offers Save, Discard or Reload.
 * @param {{state?: "dirty"|"saving"|"saved"|"conflict"|"error", count?: number, message?: string, problems?: number}} p
 * `state` defaults to "dirty". `count` is the number of unsaved changes. `message` replaces the default text. `problems` (dirty only) disables Save and says how many to fix.
 * @emits savebar:save, savebar:discard, savebar:reload
 * @states dirty, saving, saved, conflict, error
 * @a11y Motion: the bar and its buttons ease their colours over --dur-2 when the state changes; the press scale comes from base.css. Reduced motion drops the press scale only. Only the message is a live region (role="status", or role="alert" for conflict and error), so button focus is not re-announced. The region is recreated on each render, which some screen readers do not announce, so the app should also announce each transition (Saving, Saved, Conflict) through the persistent announcer of the toaster (toastHost and createToaster in toast.js). Saving, and Save while problems block it, use aria-disabled plus data-disabled on the buttons (they keep focus; delegate does not skip them, so the app must ignore an act whose element has data-disabled) and says "Saving...". After Saved the buttons go away, so the app should move focus to the form. The state glyph is decorative CSS content with empty alt text. Conflict explains that someone else saved first and offers Reload, which drops the local edits; error offers Retry.
 * @example dirty: savebar({ state: "dirty", count: 3 })
 * @example saving: savebar({ state: "saving", count: 3 })
 * @example saved: savebar({ state: "saved" })
 * @example conflict: savebar({ state: "conflict" })
 * @example error: savebar({ state: "error", message: "Could not save: the server did not answer." })
 */
export function savebar(p) {
  const q = p || {};
  const state = STATES.indexOf(/** @type {string} */ (q.state)) >= 0 ? /** @type {string} */ (q.state) : "dirty";
  const n = typeof q.count === "number" ? q.count : 0;
  const problems = typeof q.problems === "number" && q.problems > 0 ? q.problems : 0;
  /** @type {Record<string, string>} */
  const defaults = {
    dirty: n > 0 ? pluralize(n, "unsaved change") : "Unsaved changes",
    saving: "Saving…",
    saved: "All changes saved",
    conflict: "These settings were changed by someone else since you opened them. Reload to see the latest version; your edits here will be lost.",
    error: "Could not save your changes.",
  };
  const text = q.message != null && q.message !== "" ? q.message : defaults[state];
  const role = state === "conflict" || state === "error" ? "alert" : "status";
  const busy = state === "saving";
  const blocked = state === "dirty" && problems > 0;
  const warn = blocked ? html` <span class="gk-savebar__warn">Fix ${pluralize(problems, "problem")} to save.</span>` : "";
  /** @type {any} */
  let actions = "";
  if (state === "dirty" || state === "saving" || state === "error") {
    actions = html`<button type="button" class="gk-savebar__btn gk-btn" data-variant="outline" data-act="savebar:discard" data-k="savebar-discard"${busy ? html` aria-disabled="true" data-disabled="true"` : ""}>Discard</button><button type="button" class="gk-savebar__btn gk-btn is-primary" data-variant="default" data-act="savebar:save" data-k="savebar-save"${busy || blocked ? html` aria-disabled="true" data-disabled="true"` : ""}>${busy ? "Saving…" : state === "error" ? "Retry" : "Save changes"}</button>`;
  } else if (state === "conflict") {
    actions = html`<button type="button" class="gk-savebar__btn gk-btn is-primary" data-variant="default" data-act="savebar:reload" data-k="savebar-reload">Reload</button>`;
  }
  return html`<div class="gk-savebar is-${state}"><span class="gk-savebar__text" role="${role}">${text}${warn}</span>${actions ? html`<span class="gk-savebar__actions">${actions}</span>` : ""}</div>`;
}
