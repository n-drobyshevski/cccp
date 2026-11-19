// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html, attrs } from "@gas-kit/client/html.js";

/**
 * @component label
 * @title Label
 * @category Forms
 * @summary A form label tied to a control by id, with an optional required marker.
 * @param {{text: string, for?: string, required?: boolean, id?: string}} p
 * `for` is the id of the control. `required` adds a visible asterisk (aria-hidden) and the sr-only word "required" after the text; it does not set the native attribute on the control, so pass `required` to the control as well.
 * @emits none
 * @states default, required
 * @a11y A native label element, so a click focuses the control and the text is its accessible name. The required marker is a symbol plus a spoken word, so it is not colour alone.
 * @example default: label({ text: "Email address", for: "f-email" })
 * @example required: label({ text: "Company name", for: "f-company", required: true })
 */
export function label(p) {
  const q = p || { text: "" };
  return html`<label ${attrs({ class: "gk-label", for: q.for != null && q.for !== "" ? q.for : null, id: q.id != null && q.id !== "" ? q.id : null })}>${q.text != null ? q.text : ""}${q.required === true ? html`<span class="gk-label__req" aria-hidden="true">*</span><span class="sr-only"> required</span>` : ""}</label>`;
}
