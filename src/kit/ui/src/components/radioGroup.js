// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A group of native radios with a label. The browser gives arrow-key movement for free.
import { html, attrs } from "@gas-kit/client/html.js";

/**
 * @component radioGroup
 * @title Radio Group
 * @category Forms
 * @summary A labelled group of native radio buttons.
 * @param {{label: string, name: string, options: {value: string, label: string, description?: string, disabled?: boolean}[], value?: string, id?: string, orientation?: "vertical"|"horizontal", hideLabel?: boolean, invalid?: boolean, describedby?: string, required?: boolean, disabled?: boolean, act?: string, k?: string}} p
 * `name` is the native radio group name (required, or the radios would not group). `value` selects the option with that value. `id` defaults to "rg-" plus `name`; the options get ids `<id>-<index>`. The group is a div with role="radiogroup" named by its visible label (`hideLabel` keeps it sr-only). `act` goes on every radio as `data-act` (with `data-v` set to the option value) for a delegated "change" listener; `k` prefixes each radio's `data-k` as `<k>-<index>`. `disabled` disables every option; an option can also be disabled alone.
 * @emits radioGroup:change (the act you pass; data-k, data-v)
 * @states default, selected, horizontal, invalid, disabled
 * @a11y role="radiogroup" with aria-labelledby on the label, native radios with their own labels, so Tab enters the group and the arrow keys move and select. The selected option is shown by the filled dot as well as colour. Invalid sets aria-invalid on the group; pair it with a visible message.
 * @example default: radioGroup({ label: "Plan", name: "plan", options: [{ value: "free", label: "Free" }, { value: "team", label: "Team" }], k: "rg-plan" })
 * @example selected: radioGroup({ label: "Plan", name: "plan2", value: "team", options: [{ value: "free", label: "Free" }, { value: "team", label: "Team", description: "Up to 20 seats." }], k: "rg-plan2" })
 * @example horizontal: radioGroup({ label: "Density", name: "density", orientation: "horizontal", value: "cozy", options: [{ value: "cozy", label: "Cozy" }, { value: "compact", label: "Compact" }] })
 * @example invalid: radioGroup({ label: "Channel", name: "channel", invalid: true, required: true, options: [{ value: "email", label: "Email" }, { value: "chat", label: "Chat" }] })
 * @example disabled: radioGroup({ label: "Region", name: "region", disabled: true, value: "eu", options: [{ value: "eu", label: "Europe" }, { value: "us", label: "Americas" }] })
 */
export function radioGroup(p) {
  const q = p || { label: "", name: "", options: [] };
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  const id = has(q.id) ? String(q.id) : "rg-" + String(q.name != null ? q.name : "").replace(/[^A-Za-z0-9_-]+/g, "-");
  const opts = Array.isArray(q.options) ? q.options : [];
  const labelId = id + "-label";
  return html`<div ${attrs({
    class: "gk-radioGroup" + (q.orientation === "horizontal" ? " is-horizontal" : ""),
    role: "radiogroup",
    "aria-labelledby": labelId,
    "aria-describedby": has(q.describedby) ? q.describedby : null,
    "aria-invalid": q.invalid === true ? "true" : null,
    "aria-required": q.required === true ? "true" : null,
    id,
  })}><span class="${q.hideLabel ? "sr-only" : "gk-radioGroup__label"}" id="${labelId}">${q.label != null ? q.label : ""}</span><div class="gk-radioGroup__items">${opts.map((o, i) => {
    const oid = id + "-" + i;
    const hasDesc = o != null && has(o.description);
    return html`<div class="gk-radioGroup__item"><input ${attrs({
      type: "radio",
      class: "gk-radioGroup__radio",
      id: oid,
      name: q.name,
      value: o != null && o.value != null ? o.value : "",
      checked: o != null && q.value != null && o.value === q.value,
      disabled: q.disabled === true || (o != null && o.disabled === true),
      required: q.required === true && i === 0,
      "aria-describedby": hasDesc ? oid + "-desc" : null,
      "data-act": has(q.act) ? q.act : null,
      "data-k": has(q.k) ? q.k + "-" + i : null,
      "data-v": o != null && o.value != null ? o.value : null,
    })}><span class="gk-radioGroup__text"><label class="gk-radioGroup__option" for="${oid}">${o != null && o.label != null ? o.label : ""}</label>${hasDesc ? html`<span class="gk-radioGroup__desc" id="${oid + "-desc"}">${o.description}</span>` : ""}</span></div>`;
  })}</div></div>`;
}
