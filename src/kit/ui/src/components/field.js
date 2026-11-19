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
 * @param {{label: string, id?: string, kind?: "input"|"textarea"|"custom", props?: object, control?: (c: {id: string, describedby: string|null, invalid: boolean, required: boolean}) => unknown, description?: string, error?: string, required?: boolean, orientation?: "vertical"|"horizontal", k?: string}} p
 * `orientation` "horizontal" puts the label and description in a column beside the control (a settings row, good for a switch or checkbox); the default "vertical" stacks them and renders exactly as before. `id` is the control id (default "field-" plus the label with every character outside A-Z, a-z, 0-9, _ and - replaced by a dash; pass `id` whenever labels may collide). `kind` "input" (the default) and "textarea" build the control from `props`, which takes the props of the `input` or `textarea` view (type, name, value, placeholder, act, k and so on; `id`, `describedby`, `invalid` and `required` are set by the field). `kind: "custom"` calls `control` with `{id, describedby, invalid, required}` and the function must put them on its element, for example in a checkbox or select. `description` is help text under the control; `error` is the message that puts the field in the invalid state and shows below the control. The description has the id `<id>-desc` and the error `<id>-err`, and both are listed in the control's aria-describedby.
 * @emits none
 * @states default, described, invalid, required, horizontal
 * @a11y The label is a native label for the control id. aria-describedby points at the description and the error message, and aria-invalid is set when there is an error. The error text is visible and has role="alert", so an error added by a re-render is announced; the red border and text are paired with that message, never colour alone. A required field shows an asterisk and the spoken word "required".
 * @example default: field({ label: "Company name", id: "f-company", props: { name: "company", placeholder: "Acme Ltd" } })
 * @example described: field({ label: "Email", id: "f-email", description: "We only use it for alerts.", props: { type: "email", name: "email" } })
 * @example invalid: field({ label: "Email", id: "f-mail2", error: "Enter an address such as name@example.org.", props: { type: "email", value: "name@" } })
 * @example required: field({ label: "Notes", id: "f-notes", kind: "textarea", required: true, description: "Visible to administrators.", props: { name: "notes" } })
 * @example horizontal: field({ label: "Seats", id: "f-seats", orientation: "horizontal", description: "Billed per seat each month.", props: { type: "number", name: "seats", value: "5" } })
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
  return html`<div class="gk-field${q.orientation === "horizontal" ? " is-horizontal" : ""}${hasErr ? " is-invalid" : ""}"${q.k != null && q.k !== "" ? html` data-k="${q.k}"` : ""}>${label({ text: q.label, for: id, required: c.required })}${control}${hasDesc ? html`<p class="gk-field__desc" id="${id + "-desc"}">${q.description}</p>` : ""}${hasErr ? html`<p class="gk-field__error" id="${id + "-err"}" role="alert">${q.error}</p>` : ""}</div>`;
}

/**
 * @component fieldSet
 * @title Field Set
 * @category Forms
 * @summary A real fieldset with a legend, a description, grouped fields and an error message.
 * @param {{legend: string, content: unknown, description?: string, error?: string, orientation?: "vertical"|"horizontal", variant?: "legend"|"label", id?: string, k?: string}} p
 * `content` is ready SafeHtml, typically several `field` views, checkboxes or a radio group. `id` is the fieldset id (default "fs-" plus the legend with every character outside A-Z, a-z, 0-9, _ and - replaced by a dash; pass `id` whenever legends may collide); the description has the id `<id>-desc` and the error `<id>-err`, and both are listed in the fieldset's aria-describedby. `variant` "legend" (the default) styles the legend as a section heading, "label" as a field label. `orientation` "horizontal" lays the content out in a wrapping row instead of a column.
 * @emits none
 * @states default, described, invalid, label
 * @a11y A native fieldset named by its legend, so a screen reader announces the group name with each control inside. The description and the error are linked with aria-describedby on the fieldset. The error text is visible with role="alert", so one added by a re-render is announced; the red text is paired with that message, never colour alone.
 * @example default: fieldSet({ legend: "Contact", content: field({ label: "Company name", id: "fs-company", props: { name: "company" } }) })
 * @example described: fieldSet({ legend: "Address", id: "fs-address", description: "Used on invoices.", content: field({ label: "Street", id: "fs-street", props: { name: "street", placeholder: "1 Example Road" } }) })
 * @example invalid: fieldSet({ legend: "Channels", id: "fs-channels", error: "Pick at least one channel.", content: field({ label: "Email address", id: "fs-email", props: { name: "email" } }) })
 * @example label: fieldSet({ legend: "Notify me about", id: "fs-notify", variant: "label", orientation: "horizontal", content: field({ label: "Seats", id: "fs-seats", props: { type: "number", name: "seats" } }) })
 */
export function fieldSet(p) {
  const q = p || { legend: "", content: "" };
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  const id = has(q.id) ? String(q.id) : "fs-" + String(q.legend != null ? q.legend : "").replace(/[^A-Za-z0-9_-]+/g, "-");
  const hasDesc = has(q.description);
  const hasErr = has(q.error);
  const ids = [hasDesc ? id + "-desc" : "", hasErr ? id + "-err" : ""].filter(Boolean);
  const cls = "gk-fieldset" + (q.orientation === "horizontal" ? " is-horizontal" : "") + (hasErr ? " is-invalid" : "");
  const leg = "gk-fieldset__legend" + (q.variant === "label" ? " is-label" : "");
  return html`<fieldset class="${cls}" id="${id}"${ids.length ? html` aria-describedby="${ids.join(" ")}"` : ""}${has(q.k) ? html` data-k="${q.k}"` : ""}><legend class="${leg}">${q.legend != null ? q.legend : ""}</legend>${hasDesc ? html`<p class="gk-field__desc" id="${id + "-desc"}">${q.description}</p>` : ""}<div class="gk-fieldset__content">${q.content != null ? q.content : ""}</div>${hasErr ? html`<p class="gk-field__error" id="${id + "-err"}" role="alert">${q.error}</p>` : ""}</fieldset>`;
}
