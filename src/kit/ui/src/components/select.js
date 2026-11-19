// Extracted from the author's production Apps Script apps; adapted.
// A native select with a real label (for=id), optional hint and error text, and disabled and
// invalid states. Native, so the keyboard and screen-reader behaviour is the platform's.
// Wire it with delegate(root, "change", '[data-act="select:change"]', fn); data-field is name.
import { attrs, html } from "@gas-kit/client/html.js";

/**
 * @param {any} o
 * @param {string} value
 * @param {boolean} hasPlaceholder
 */
function option(o, value, hasPlaceholder) {
  const sel = String(o.value) === value && !(hasPlaceholder && value === "");
  return html`<option ${attrs({ value: o.value, selected: sel, disabled: !!o.disabled })}>${o.label == null ? o.value : o.label}</option>`;
}

/**
 * @component select
 * @title Select
 * @category Forms
 * @summary A labelled native dropdown with hint, error, disabled and invalid states.
 * @param {{id: string, name?: string, label: string, options: Array<any>, value?: string|number|null, placeholder?: string|null, hint?: string|null, error?: string|null, disabled?: boolean, invalid?: boolean, required?: boolean}} p
 * @emits select:change (data-field is the name; read the value from the element)
 * @states default, placeholder, disabled, invalid
 * @a11y A visible label with for=id (without an id the label wraps the control; the hint and error then have no aria-describedby link, so pass an id). aria-invalid and aria-describedby point at the error and hint text; the error text starts with the word Error so it is not colour alone. Options may be {group, options} for an optgroup.
 * @example default: select({ id: "env", name: "env", label: "Environment", value: "b", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] })
 * @example placeholder: select({ id: "env", label: "Environment", placeholder: "Choose one", options: [{ value: "a", label: "Alpha" }] })
 * @example disabled: select({ id: "env", label: "Environment", value: "a", disabled: true, options: [{ value: "a", label: "Alpha" }] })
 * @example invalid: select({ id: "env", label: "Environment", invalid: true, error: "Pick an environment", placeholder: "Choose one", options: [{ value: "a", label: "Alpha" }] })
 */
export function select(p) {
  const id = p.id == null ? "" : String(p.id);
  const value = p.value == null ? "" : String(p.value);
  const invalid = !!(p.invalid || p.error);
  const desc = id && [p.error ? id + "-error" : "", p.hint ? id + "-hint" : ""].filter(Boolean).join(" ");
  const opts = (p.options || []).map(/** @param {any} o */ (o) =>
    o.group != null
      ? html`<optgroup label="${o.group}">${(o.options || []).map(/** @param {any} c */ (c) => option(c, value, !!p.placeholder))}</optgroup>`
      : option(o, value, !!p.placeholder));
  const labelText = html`${p.label}${p.required ? html`<span class="gk-select__req"> (required)</span>` : null}`;
  // Without an id the label cannot use for=, so it wraps the control instead.
  const wrap = (/** @type {any} */ inner) => id
    ? html`<label class="gk-select__label" ${attrs({ for: id })}>${labelText}</label>${inner}`
    : html`<label class="gk-select__label is-wrapping"><span>${labelText}</span>${inner}</label>`;
  return html`<div class="gk-select${p.disabled ? " is-disabled" : ""}${invalid ? " is-invalid" : ""}">${wrap(html`<span class="gk-select__wrap"><select class="gk-select__control gk-input" ${attrs({
    id: id || null, name: p.name, "data-act": "select:change", "data-field": p.name || id || null, "data-k": id ? "select-" + id : null,
    disabled: !!p.disabled, required: !!p.required, "aria-invalid": invalid ? "true" : null, "aria-describedby": desc || null,
  })}>${p.placeholder ? html`<option ${attrs({ value: "", disabled: true, selected: value === "" })}>${p.placeholder}</option>` : null}${opts}</select></span>`)}${
    p.hint ? html`<span class="gk-select__hint" ${attrs({ id: id ? id + "-hint" : null })}>${p.hint}</span>` : null
  }${p.error ? html`<span class="gk-select__error" ${attrs({ id: id ? id + "-error" : null })}><strong>Error:</strong> ${p.error}</span>` : null}</div>`;
}
