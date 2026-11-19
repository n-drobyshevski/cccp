// Extracted from the author's production Apps Script apps; adapted.
// An on/off switch: a button with role=switch. The app wires it with delegate on data-act.
import { html } from "@gas-kit/client/html.js";

/**
 * @component switch
 * @title Switch
 * @category Forms
 * @summary An on/off switch with a visible label.
 * @param {{label: string, checked?: boolean, disabled?: boolean, k?: string, v?: string, act?: string, tip?: string, hideLabel?: boolean}} p
 * `act` defaults to "switch:toggle"; `v` rides in `data-v` so one handler can tell switches apart; `k` defaults to "switch-" plus `v` or the label with every character outside A-Z, a-z, 0-9, _ and - replaced by a dash (so labels in other scripts, or that differ only in punctuation, can collide: pass `k` or `v` whenever labels may collide); `hideLabel` keeps the label for screen readers only.
 * @emits switch:toggle (data-v; or the act you pass)
 * @states off, on, disabled
 * @a11y Motion: the knob slides on a short spring over --dur-3 and the colours ease over --dur-2; reduced motion drops the slide (the knob jumps to its position, which is the state) and keeps the colour fade. A native button with role="switch" and aria-checked; the label is its accessible name and Space or Enter toggle it. State is shown by the knob position as well as colour. A disabled switch uses aria-disabled, not the native attribute, so it stays focusable and its tip is reachable; the app must ignore its act (it carries data-disabled and aria-disabled, and the CSS only shows a not-allowed cursor; delegate does not skip it). The tip is also sr-only text inside the button (after the label), so it is part of the accessible name in browse mode and without tip.js; there is no static aria-describedby, because tip.js sets and clears that attribute itself on hover and focus.
 * @example on: switchView({ label: "Email alerts", checked: true, k: "sw-alerts", v: "alerts" })
 * @example off: switchView({ label: "Email alerts", k: "sw-alerts", v: "alerts" })
 * @example disabled: switchView({ label: "Email alerts", checked: true, disabled: true, tip: "Managed by an administrator", k: "sw-alerts", v: "alerts" })
 */
export function switchView(p) {
  const q = p || { label: "" };
  const on = q.checked === true;
  const k = q.k || "switch-" + String(q.v != null && q.v !== "" ? q.v : q.label != null ? q.label : "").replace(/[^A-Za-z0-9_-]+/g, "-");
  const tip = q.tip != null && q.tip !== "" ? q.tip : null;
  return html`<button type="button" role="switch" class="gk-switch${on ? " is-on" : ""}" aria-checked="${on ? "true" : "false"}" data-act="${q.act || "switch:toggle"}" data-k="${k}"${q.v != null ? html` data-v="${q.v}"` : ""}${q.disabled ? html` aria-disabled="true" data-disabled="true"` : ""}${tip ? html` data-tip="${tip}"` : ""}><span class="gk-switch__track" aria-hidden="true"><span class="gk-switch__knob"></span></span><span class="${q.hideLabel ? "sr-only" : "gk-switch__label"}">${q.label}</span>${tip ? html`<span class="sr-only">. ${tip}</span>` : ""}</button>`;
}
