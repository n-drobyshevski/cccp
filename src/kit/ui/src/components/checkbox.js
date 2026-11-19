// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A styled native checkbox. The check mark is a CSS border shape on :checked, no image.
import { html, attrs } from "@gas-kit/client/html.js";

/**
 * @component checkbox
 * @title Checkbox
 * @category Forms
 * @summary A native checkbox with a visible label and an optional description.
 * @param {{label: string, id?: string, name?: string, value?: string, checked?: boolean, disabled?: boolean, required?: boolean, invalid?: boolean, description?: string, describedby?: string, hideLabel?: boolean, act?: string, k?: string, v?: string}} p
 * `id` defaults to "cb-" plus `k`, `v` or the label with every character outside A-Z, a-z, 0-9, _ and - replaced by a dash (pass `id` or `k` whenever labels may collide). `description` renders under the label and is wired to the input through aria-describedby (joined with `describedby`). `hideLabel` keeps the label for screen readers only. `act` is `data-act` for a delegated "change" listener; the app reads `checked` from the event target. The control is a native input with appearance none, so the check is drawn by CSS (a clip-path shape).
 * @emits checkbox:change (the act you pass; data-k, data-v)
 * @states unchecked, checked, disabled, invalid
 * @a11y A native input type checkbox inside its label, so the whole row is clickable and the label is the name. The checked state is shown by a check mark shape as well as the fill, and a disabled one is at half opacity with a not-allowed cursor. Invalid sets aria-invalid; pair it with a visible message through `field` or `describedby`.
 * @example checked: checkbox({ label: "Email me weekly", name: "weekly", checked: true, description: "A summary every Monday.", k: "cb-weekly2" })
 * @example unchecked: checkbox({ label: "Email me weekly", name: "weekly", k: "cb-weekly" })
 * @example disabled: checkbox({ label: "Managed by policy", checked: true, disabled: true, k: "cb-policy" })
 * @example invalid: checkbox({ label: "I accept the terms", required: true, invalid: true, k: "cb-terms" })
 */
export function checkbox(p) {
  const q = p || { label: "" };
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  const slug = String(has(q.k) ? q.k : has(q.v) ? q.v : q.label != null ? q.label : "").replace(/[^A-Za-z0-9_-]+/g, "-");
  const id = has(q.id) ? String(q.id) : "cb-" + slug;
  const hasDesc = has(q.description);
  const ids = [hasDesc ? id + "-desc" : "", has(q.describedby) ? q.describedby : ""].filter(Boolean).join(" ");
  return html`<div class="gk-checkbox${q.disabled ? " is-disabled" : ""}"><input ${attrs({
    type: "checkbox",
    class: "gk-checkbox__box",
    id,
    name: has(q.name) ? q.name : null,
    value: has(q.value) ? q.value : null,
    checked: q.checked === true,
    disabled: q.disabled === true,
    required: q.required === true,
    "aria-invalid": q.invalid === true ? "true" : null,
    "aria-describedby": ids || null,
    "data-act": has(q.act) ? q.act : null,
    "data-k": has(q.k) ? q.k : null,
    "data-v": q.v != null ? q.v : null,
  })}><span class="gk-checkbox__text"><label class="${q.hideLabel ? "sr-only" : "gk-checkbox__label"}" for="${id}">${q.label != null ? q.label : ""}</label>${hasDesc ? html`<span class="gk-checkbox__desc" id="${id + "-desc"}">${q.description}</span>` : ""}</span></div>`;
}
