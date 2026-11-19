// Extracted from the author's production Apps Script apps; adapted.
// A settings form from a field schema. The model half is DOM-free: defaults, validation by
// field type, order-blind comparison, dirty tracking and a patch that holds only what changed.
// The view half renders each field with its label, hint and error wired by aria-describedby.
// The app listens with delegate on data-act="settingsForm:change", reads the form with
// collectValues, runs the model and re-renders with renderRegion.
import { attrs, html } from "@gas-kit/client/html.js";

/** The field types the view and the model understand. */
export const FIELD_TYPES = ["text", "number", "select", "toggle", "list"];

/**
 * @typedef {{name: string, type: "text"|"number"|"select"|"toggle"|"list", label: string, hint?: string, placeholder?: string, required?: boolean, options?: Array<{value: string, label?: string}>, min?: number, max?: number, maxLength?: number, maxItems?: number, pattern?: string, patternMessage?: string, validate?: (value: any, values: Record<string, any>) => string|null|undefined, disabled?: boolean, default?: any}} Field
 */

/**
 * Throw on a schema that cannot work: a missing or repeated name or an unknown type. Called by
 * the other model functions so a typo fails loudly and early.
 * @param {Field[]} schema
 * @returns {Field[]}
 * @internal
 */
export function checkSchema(schema) {
  const seen = new Set();
  for (const f of schema || []) {
    if (!f || !f.name) throw new Error("settingsForm: a field has no name");
    if (FIELD_TYPES.indexOf(f.type) < 0) throw new Error("settingsForm: unknown type " + f.type + " for " + f.name);
    if (seen.has(f.name)) throw new Error("settingsForm: duplicate field " + f.name);
    seen.add(f.name);
  }
  return schema;
}

/**
 * The value a field has when nothing is stored.
 * @param {Field} f
 * @internal
 */
export function fieldDefault(f) {
  if (f.default !== undefined) return f.default;
  if (f.type === "toggle") return false;
  if (f.type === "list") return [];
  if (f.type === "number") return null;
  return "";
}

/**
 * @param {Field[]} schema
 * @param {Record<string, any>} [stored]
 * @returns {Record<string, any>} one entry per field, stored values over defaults
 * @internal
 */
export function defaultValues(schema, stored) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const f of checkSchema(schema)) {
    out[f.name] = stored && stored[f.name] !== undefined ? stored[f.name] : fieldDefault(f);
  }
  return out;
}

/**
 * Deep equality for form values: arrays ignore order, objects compare by key, leaves use
 * Object.is so NaN equals NaN.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 * @internal
 */
export function sameValue(a, b) {
  if (a === b || Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const rest = b.slice();
    for (const x of a) {
      const i = rest.findIndex((y) => sameValue(x, y));
      if (i < 0) return false;
      rest.splice(i, 1);
    }
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
  }
  return false;
}

/**
 * The message for one field's value, or null when it is fine. A blank optional field is fine.
 * @param {Field} f
 * @param {any} value
 * @param {Record<string, any>} [values] all values, for cross-field rules
 * @returns {string|null}
 * @internal
 */
export function validateField(f, value, values) {
  // NaN is NOT blank: it is text that is not a number, reported by the number rule below.
  const blank = value == null || value === "" || (Array.isArray(value) && value.length === 0);
  if (blank) {
    if (f.required && f.type !== "toggle") return f.label + " is required";
  } else if (f.type === "number") {
    if (typeof value !== "number" || !isFinite(value)) return f.label + " must be a number";
    if (f.min != null && value < f.min) return f.label + " must be at least " + f.min;
    if (f.max != null && value > f.max) return f.label + " must be at most " + f.max;
  } else if (f.type === "text") {
    const s = String(value);
    if (f.maxLength != null && s.length > f.maxLength) return f.label + " must be at most " + f.maxLength + " characters";
    if (f.pattern && !new RegExp(f.pattern).test(s)) return f.patternMessage || f.label + " is not in the expected format";
  } else if (f.type === "select") {
    if (!(f.options || []).some((o) => String(o.value) === String(value))) return f.label + " must be one of the listed choices";
  } else if (f.type === "list") {
    if (!Array.isArray(value)) return f.label + " must be a list";
    if (f.maxItems != null && value.length > f.maxItems) return f.label + " can have at most " + f.maxItems + " entries";
  }
  if (f.validate) {
    const m = f.validate(value, values || {});
    if (m) return m;
  }
  return null;
}

/**
 * Every problem, keyed by field name. A field without a problem has NO key, so read the result
 * by key presence.
 * @param {Field[]} schema
 * @param {Record<string, any>} values
 * @returns {Record<string, string>}
 * @internal
 */
export function validateAll(schema, values) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of checkSchema(schema)) {
    const m = validateField(f, values[f.name], values);
    if (m) out[f.name] = m;
  }
  return out;
}

/**
 * Names of the fields whose value differs from the base.
 * @param {Field[]} schema
 * @param {Record<string, any>} base
 * @param {Record<string, any>} values
 * @returns {string[]}
 * @internal
 */
export function dirtyFields(schema, base, values) {
  return checkSchema(schema).filter((f) => !sameValue(base[f.name], values[f.name])).map((f) => f.name);
}

/**
 * The patch to send: only the changed fields.
 * @param {Field[]} schema
 * @param {Record<string, any>} base
 * @param {Record<string, any>} values
 * @returns {Record<string, any>}
 * @internal
 */
export function formPatch(schema, base, values) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const n of dirtyFields(schema, base, values)) out[n] = values[n];
  return out;
}

/**
 * Turn the text of a list textarea into entries: one per line, trimmed, blanks dropped.
 * @param {string} text
 * @returns {string[]}
 * @internal
 */
export function parseList(text) {
  return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * A small stateful model: the saved base, the edited values, errors and dirty state.
 * @param {Field[]} schema
 * @param {Record<string, any>} [stored]
 * @internal
 */
export function createFormModel(schema, stored) {
  checkSchema(schema);
  let base = defaultValues(schema, stored);
  let values = Object.assign({}, base);
  const model = {
    /** @returns {Record<string, any>} */
    get values() { return values; },
    /** @returns {Record<string, any>} */
    get base() { return base; },
    /** @param {string} name @param {any} v */
    set(name, v) {
      if (!schema.some((f) => f.name === name)) throw new Error("settingsForm: unknown field " + name);
      values = Object.assign({}, values, { [name]: v });
    },
    /** @param {Record<string, any>} v */
    setAll(v) { values = Object.assign({}, values, v); },
    errors() { return validateAll(schema, values); },
    dirty() { return dirtyFields(schema, base, values); },
    isDirty() { return dirtyFields(schema, base, values).length > 0; },
    patch() { return formPatch(schema, base, values); },
    /** Adopt the saved state as the new base (after a successful save). `saved` may be just the patch that was sent: it is merged over the current values. @param {Record<string, any>} [saved] */
    markSaved(saved) { base = defaultValues(schema, Object.assign({}, values, saved || {})); values = Object.assign({}, base); },
    discard() { values = Object.assign({}, base); },
  };
  return model;
}

/**
 * Read a form element into values. Controls are found by data-field; a toggle reads checked,
 * a number reads a number (null when blank, NaN when not numeric), a list reads one entry per
 * line. A field with no control in the form keeps the fallback value.
 * @param {Element} form
 * @param {Field[]} schema
 * @param {Record<string, any>} [fallback]
 * @returns {Record<string, any>}
 * @internal
 */
export function collectValues(form, schema, fallback) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const f of checkSchema(schema)) {
    const el = /** @type {any} */ (form.querySelector('[data-field="' + f.name.replace(/["\\]/g, "") + '"]'));
    if (!el) { out[f.name] = fallback && fallback[f.name] !== undefined ? fallback[f.name] : fieldDefault(f); continue; }
    if (f.type === "toggle") out[f.name] = !!el.checked;
    else if (f.type === "number") {
      const t = String(el.value == null ? "" : el.value).trim();
      out[f.name] = t === "" ? null : Number(t);
    } else if (f.type === "list") out[f.name] = parseList(el.value);
    else out[f.name] = String(el.value == null ? "" : el.value);
  }
  return out;
}

/**
 * The text each number and list control holds right now, keyed by field name. Pass it to the
 * view as `raw` so a re-render shows back exactly what was typed ("abc", "-", "1.", a list with
 * a trailing newline) instead of the parsed value. Other field types are not included.
 * @param {Element} form
 * @param {Field[]} schema
 * @returns {Record<string, string>}
 * @internal
 */
export function collectRaw(form, schema) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of checkSchema(schema)) {
    if (f.type !== "number" && f.type !== "list") continue;
    const el = /** @type {any} */ (form.querySelector('[data-field="' + f.name.replace(/["\\]/g, "") + '"]'));
    if (el && el.value != null) out[f.name] = String(el.value);
  }
  return out;
}

/**
 * @param {Field} f
 * @param {any} v
 * @param {string|undefined} err
 * @param {string} id
 * @param {boolean} off
 * @param {string|undefined} raw the control text to show as typed (number and list only)
 */
function control(f, v, err, id, off, raw) {
  const desc = [err ? id + "-error" : "", f.hint ? id + "-hint" : ""].filter(Boolean).join(" ");
  const common = {
    id, "data-field": f.name, "data-act": "settingsForm:change", "data-k": "field-" + f.name,
    "aria-invalid": err ? "true" : null, "aria-describedby": desc || null, disabled: off || !!f.disabled, required: !!f.required,
  };
  if (f.type === "select") {
    const opts = f.options || [];
    const known = opts.some((o) => String(o.value) === String(v == null ? "" : v));
    // A value that is not among the options gets a blank, selected placeholder, so the browser
    // does not silently show and submit the first option as if the person had chosen it.
    const blank = known ? null : html`<option value="" selected></option>`;
    return html`<select class="gk-settingsForm__control gk-input" ${attrs(common)}>${blank}${opts.map((o) => html`<option ${attrs({ value: o.value, selected: known && String(o.value) === String(v == null ? "" : v) })}>${o.label == null ? o.value : o.label}</option>`)}</select>`;
  }
  if (f.type === "toggle") {
    return html`<input type="checkbox" role="switch" class="gk-settingsForm__switch" ${attrs(Object.assign({}, common, { checked: !!v, required: false }))}>`;
  }
  if (f.type === "list") {
    return html`<textarea class="gk-settingsForm__control gk-input" rows="4" ${attrs(Object.assign({}, common, { placeholder: f.placeholder || null }))}>
${raw !== undefined ? raw : (Array.isArray(v) ? v : []).join("\n")}</textarea>`;
  }
  return html`<input class="gk-settingsForm__control gk-input" ${attrs(Object.assign({}, common, {
    type: "text", value: raw !== undefined && f.type === "number" ? raw : v == null || (typeof v === "number" && Number.isNaN(v)) ? "" : v, placeholder: f.placeholder || null,
    maxlength: f.maxLength, inputmode: f.type === "number" ? "decimal" : null,
  }))}>`;
}

/**
 * @component settingsForm
 * @title Settings Form
 * @category Domain
 * @summary A form of labelled fields (text, number, select, toggle, list) built from a schema, with hints and validation messages.
 * @param {{schema: Field[], values?: Record<string, any>, raw?: Record<string, string>, errors?: Record<string, string>, idPrefix?: string, disabled?: boolean, legend?: string}} p
 * `schema` is a list of {name, type, label, hint, options, required, min, max, ...}. `min` and `max` are checked by the validator only; the input is type=text, so state the range in `hint`.
 * `raw` is collectRaw(form, schema): the text of number and list controls as typed. When a re-render follows a change or input event, pass it so the box is not rebuilt from the parsed value (which would erase "abc", turn "-" into nothing, drop "1." to "1" and lose a trailing newline in a list). A field with no raw entry renders from `values`. `errors` maps a field name to its message; show them only for fields the person has touched, as the app decides.
 * @emits settingsForm:change (data-field is the field name; change or input event, then read the form with collectValues)
 * @states default, invalid, disabled
 * @a11y Every control has a visible label with for=id. Hints and errors are linked with aria-describedby, an invalid control has aria-invalid, and the error text starts with the word Error so it is not colour alone. A toggle is a native checkbox with role=switch, so its checked state is the native one. A number is a text input with inputmode=decimal, so the raw text reaches the validator and the message "must be a number" can fire. A list is a textarea with one entry per line.
 * @example default: settingsForm({ legend: "Display", schema: [{ name: "title", type: "text", label: "Title", hint: "Shown in the header", maxLength: 40 }, { name: "pageSize", type: "number", label: "Page size", min: 10, max: 200 }, { name: "theme", type: "select", label: "Theme", options: [{ value: "auto", label: "Automatic" }, { value: "dark", label: "Dark" }] }, { name: "compact", type: "toggle", label: "Compact rows" }, { name: "tags", type: "list", label: "Tags", hint: "One per line" }], values: { title: "Acme register", pageSize: 50, theme: "auto", compact: true, tags: ["core", "edge"] } })
 * @example invalid: settingsForm({ schema: [{ name: "title", type: "text", label: "Title", required: true }], values: { title: "" }, errors: { title: "Title is required" } })
 * @example disabled: settingsForm({ schema: [{ name: "title", type: "text", label: "Title" }], values: { title: "Acme register" }, disabled: true })
 */
export function settingsForm(p) {
  const schema = checkSchema(p.schema || []);
  const values = p.values || {};
  const errors = p.errors || {};
  const pre = p.idPrefix || "sf";
  const fields = schema.map((f) => {
    const id = pre + "-" + f.name;
    const err = Object.prototype.hasOwnProperty.call(errors, f.name) ? errors[f.name] : undefined;
    const label = html`<label class="gk-settingsForm__label" for="${id}">${f.label}${f.required && f.type !== "toggle" ? html`<span class="gk-settingsForm__req"> (required)</span>` : null}</label>`;
    const hint = f.hint ? html`<span class="gk-settingsForm__hint" id="${id}-hint">${f.hint}</span>` : null;
    const error = err ? html`<span class="gk-settingsForm__error" id="${id}-error"><strong>Error:</strong> ${err}</span>` : null;
    const ctl = control(f, values[f.name] === undefined ? fieldDefault(f) : values[f.name], err, id, !!p.disabled, p.raw && Object.prototype.hasOwnProperty.call(p.raw, f.name) ? p.raw[f.name] : undefined);
    return f.type === "toggle"
      ? html`<div class="gk-settingsForm__field is-toggle${err ? " is-invalid" : ""}">${ctl}${label}${hint}${error}</div>`
      : html`<div class="gk-settingsForm__field${err ? " is-invalid" : ""}">${label}${ctl}${hint}${error}</div>`;
  });
  return html`<div class="gk-settingsForm${p.disabled ? " is-disabled" : ""}" data-form="settingsForm"><fieldset class="gk-settingsForm__set"${p.disabled ? html` disabled` : null}>${p.legend ? html`<legend class="gk-settingsForm__legend">${p.legend}</legend>` : null}${fields}</fieldset></div>`;
}
