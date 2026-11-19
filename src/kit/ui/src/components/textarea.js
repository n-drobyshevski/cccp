// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html, attrs } from "@gas-kit/client/html.js";

/**
 * @component textarea
 * @title Textarea
 * @category Forms
 * @summary A multi-line text input that wears the shared gk-input look.
 * @param {{id?: string, name?: string, value?: string, placeholder?: string, rows?: number, maxlength?: number, ariaLabel?: string, describedby?: string, required?: boolean, readonly?: boolean, disabled?: boolean, invalid?: boolean, act?: string, k?: string, v?: string}} p
 * The same props as `input` without `type`. `value` is the initial text, escaped as element content. `rows` defaults to 3 and the control grows with its content where the browser supports field-sizing, and is resizable vertically otherwise.
 * @emits textarea:change (the act you pass; data-k, data-v)
 * @states default, invalid, disabled
 * @a11y A native textarea; label it with `label` or `field` (same `id`) or pass `ariaLabel`. Invalid sets aria-invalid and the field view adds a visible message. Disabled uses the native attribute at half opacity.
 * @example default: textarea({ id: "ta-note", name: "note", placeholder: "Add a note", ariaLabel: "Note", k: "ta-note" })
 * @example invalid: textarea({ id: "ta-why", value: "", invalid: true, ariaLabel: "Reason", describedby: "ta-why-err", k: "ta-why" })
 * @example disabled: textarea({ id: "ta-log", value: "Locked by an administrator", disabled: true, ariaLabel: "Log" })
 */
export function textarea(p) {
  const q = p || {};
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  return html`<textarea ${attrs({
    class: "gk-input gk-textarea",
    id: has(q.id) ? q.id : null,
    name: has(q.name) ? q.name : null,
    rows: typeof q.rows === "number" && q.rows > 0 ? Math.floor(q.rows) : 3,
    placeholder: has(q.placeholder) ? q.placeholder : null,
    maxlength: has(q.maxlength) ? q.maxlength : null,
    "aria-label": has(q.ariaLabel) ? q.ariaLabel : null,
    "aria-describedby": has(q.describedby) ? q.describedby : null,
    "aria-invalid": q.invalid === true ? "true" : null,
    required: q.required === true,
    readonly: q.readonly === true,
    disabled: q.disabled === true,
    "data-act": has(q.act) ? q.act : null,
    "data-k": has(q.k) ? q.k : null,
    "data-v": q.v != null ? q.v : null,
  })}>${q.value != null ? q.value : ""}</textarea>`;
}
