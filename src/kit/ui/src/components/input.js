// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A text-like input. The shared class is gk-input; textarea and select-like controls adopt it.
import { html, attrs } from "@gas-kit/client/html.js";

const TYPES = ["text", "email", "password", "search", "tel", "url", "number", "date", "time", "datetime-local", "month", "week"];

/**
 * @component input
 * @title Input
 * @category Forms
 * @summary A single-line text input with the shared gk-input look.
 * @param {{id?: string, name?: string, type?: string, value?: string|number, placeholder?: string, autocomplete?: string, inputmode?: string, min?: string|number, max?: string|number, step?: string|number, maxlength?: number, ariaLabel?: string, describedby?: string, required?: boolean, readonly?: boolean, disabled?: boolean, invalid?: boolean, act?: string, k?: string, v?: string}} p
 * `type` is one of text, email, password, search, tel, url, number, date, time, datetime-local, month and week; anything else is text. Without a visible label pass `ariaLabel`; with one, use `label` or `field` and pass the same `id`. `describedby` is a space separated list of element ids (the field view builds it). `act` rides in `data-act` so an app can delegate "input" or "change" events; `k` is `data-k` (set it when focus must survive a re-render). The shared class: `gk-input` carries the whole look (height 36px, radius-md, a --border-strong outline, shadow-xs) and is meant for a native input, textarea or select; `aria-invalid="true"` and the native disabled attribute are styled by it.
 * @emits input:change (the act you pass; data-k, data-v)
 * @states default, invalid, disabled, readonly
 * @a11y A native input. Invalid sets aria-invalid, and the field view pairs it with a visible error message (the border change is never the only cue). Required sets the native attribute and `field` adds a visible marker plus a word. Disabled uses the native attribute at half opacity. The placeholder is a hint, never the label.
 * @example default: input({ id: "in-name", name: "name", placeholder: "Acme Ltd", ariaLabel: "Company name", k: "in-name" })
 * @example invalid: input({ id: "in-mail", type: "email", value: "not-an-email", invalid: true, ariaLabel: "Email", describedby: "in-mail-err", k: "in-mail" })
 * @example disabled: input({ id: "in-id", value: "ACME-001", disabled: true, ariaLabel: "Account id" })
 * @example readonly: input({ id: "in-url", value: "/status/acme", readonly: true, ariaLabel: "Service URL" })
 */
export function input(p) {
  const q = p || {};
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  return html`<input ${attrs({
    class: "gk-input",
    type: TYPES.indexOf(String(q.type)) >= 0 ? q.type : "text",
    id: has(q.id) ? q.id : null,
    name: has(q.name) ? q.name : null,
    value: q.value != null ? q.value : null,
    placeholder: has(q.placeholder) ? q.placeholder : null,
    autocomplete: has(q.autocomplete) ? q.autocomplete : null,
    inputmode: has(q.inputmode) ? q.inputmode : null,
    min: has(q.min) ? q.min : null,
    max: has(q.max) ? q.max : null,
    step: has(q.step) ? q.step : null,
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
  })}>`;
}
