// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A form field: label, control, description and error, wired with ids.
import { html } from "@gas-kit/client/html.js";
import { input } from "./input.js";
import { textarea } from "./textarea.js";
import { label } from "./label.js";

/**
 * @component field
 * @title Field
 * @category Forms
 * @summary A label, a control, a description and an error message, wired with aria-describedby and aria-invalid.
 * @param {{label: string, id?: string, kind?: "input"|"textarea"|"custom", props?: object, control?: (c: {id: string, describedby: string|null, invalid: boolean, required: boolean}) => unknown, description?: string, error?: string, required?: boolean, k?: string}} p
 * `id` is the control id (default "field-" plus the label with every character outside A-Z, a-z, 0-9, _ and - replaced by a dash; pass `id` whenever labels may collide). `kind` "input" (the default) and "textarea" build the control from `props`, which takes the props of the `input` or `textarea` view (type, name, value, placeholder, act, k and so on; `id`, `describedby`, `invalid` and `required` are set by the field). `kind: "custom"` calls `control` with `{id, describedby, invalid, required}` and the function must put them on its element, for example in a checkbox or select. `description` is help text under the control; `error` is the message that puts the field in the invalid state and shows below the control. The description has the id `<id>-desc` and the error `<id>-err`, and both are listed in the control's aria-describedby.
 * @emits none
 * @states default, described, invalid, required
 * @a11y The label is a native label for the control id. aria-describedby points at the description and the error message, and aria-invalid is set when there is an error. The error text is visible and has role="alert", so an error added by a re-render is announced; the red border and text are paired with that message, never colour alone. A required field shows an asterisk and the spoken word "required".
 * @example default: field({ label: "Company name", id: "f-company", props: { name: "company", placeholder: "Acme Ltd" } })
 * @example described: field({ label: "Email", id: "f-email", description: "We only use it for alerts.", props: { type: "email", name: "email" } })
 * @example invalid: field({ label: "Email", id: "f-mail2", error: "Enter an address such as name@example.org.", props: { type: "email", value: "name@" } })
 * @example required: field({ label: "Notes", id: "f-notes", kind: "textarea", required: true, description: "Visible to administrators.", props: { name: "notes" } })
 */
export function field(p) {
  const q = p || { label: "" };
  const id = q.id != null && q.id !== "" ? String(q.id) : "field-" + String(q.label != null ? q.label : "").replace(/[^A-Za-z0-9_-]+/g, "-");
  const hasDesc = q.description != null && q.description !== "";
  const hasErr = q.error != null && q.error !== "";
  const ids = [hasDesc ? id + "-desc" : "", hasErr ? id + "-err" : ""].filter(Boolean);
  const c = { id, describedby: ids.length ? ids.join(" ") : null, invalid: hasErr, required: q.required === true };
  const base = q.props || {};
  const kind = q.kind === "textarea" || q.kind === "custom" ? q.kind : "input";
  let control;
  if (kind === "custom") control = typeof q.control === "function" ? q.control(c) : "";
  else if (kind === "textarea") control = textarea({ ...base, id, describedby: c.describedby || undefined, invalid: c.invalid, required: c.required });
  else control = input({ ...base, id, describedby: c.describedby || undefined, invalid: c.invalid, required: c.required });
  return html`<div class="gk-field${hasErr ? " is-invalid" : ""}"${q.k != null && q.k !== "" ? html` data-k="${q.k}"` : ""}>${label({ text: q.label, for: id, required: c.required })}${control}${hasDesc ? html`<p class="gk-field__desc" id="${id + "-desc"}">${q.description}</p>` : ""}${hasErr ? html`<p class="gk-field__error" id="${id + "-err"}" role="alert">${q.error}</p>` : ""}</div>`;
}
