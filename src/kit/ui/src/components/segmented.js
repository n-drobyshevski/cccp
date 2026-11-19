// Extracted from the author's production Apps Script apps; adapted.
// A segmented single-choice control: a radiogroup of buttons with a roving tab stop. Arrow keys
// need a small island (segmentedIsland), which the app mounts with mountIslands.
import { html } from "@gas-kit/client/html.js";

/**
 * @component segmented
 * @title Segmented Control
 * @category Forms
 * @summary A single-choice segmented control (radiogroup) with a roving tab stop.
 * @param {{label: string, options: Array<{value: string, text?: string, tip?: string, disabled?: boolean}>, value?: string|null, k?: string, act?: string}} p
 * `value` is the selected option value; `k` prefixes each button's data-k ("<k>-<value>", default "seg"; give every control on a page its own); a disabled option is dimmed with a line through it; `act` defaults to "segmented:pick"; a `tip` is shown on hover and focus by tip.js and is also sr-only text inside the radio, so the name is the visible text followed by the tip. A selected option that is disabled still reads as checked. The island must be mounted again (mountIslands) after every render of the control, or only the arrow keys stop working and the unselected radios cannot be reached by keyboard (they are tabindex -1). A disabled option uses the native disabled attribute, so it cannot take focus and its tip is not reachable by keyboard; its tip is still in its sr-only text.
 * @emits segmented:pick (data-v; or the act you pass)
 * @states default, selected, disabled-option, empty
 * @a11y Motion: hover and selected colours ease over --dur-2; the press scale comes from base.css. Reduced motion drops the press scale only. role="radiogroup" with a label; each button is role="radio" with aria-checked. Only the selected enabled one (or the first enabled one when none is selected) is in the tab order (tabindex 0, the rest -1). The island moves the selection with Arrow keys, Home and End; it ignores Alt, Ctrl and Meta combinations and does not re-pick the already selected radio.
 * @example default: segmented({ label: "Range", k: "range", value: "30", options: [{ value: "7", text: "7 days" }, { value: "30", text: "30 days" }, { value: "90", text: "90 days" }] })
 * @example selected: segmented({ label: "Range", k: "range", value: "90", options: [{ value: "7", text: "7 days" }, { value: "30", text: "30 days" }, { value: "90", text: "90 days" }] })
 * @example disabled-option: segmented({ label: "View", k: "view", value: "list", options: [{ value: "list", text: "List" }, { value: "map", text: "Map", disabled: true }] })
 * @example empty: segmented({ label: "Range", k: "range", options: [] })
 */
export function segmented(p) {
  const q = p || { label: "", options: [], k: "seg" };
  const opts = Array.isArray(q.options) ? q.options : [];
  const sel = q.value == null ? null : String(q.value);
  const hasSel = opts.some((o) => String(o.value) === sel);
  const stopSel = opts.some((o) => String(o.value) === sel && !o.disabled);
  const kk = q.k || "seg";
  const firstOn = opts.findIndex((o) => !o.disabled);
  return html`<div class="gk-segmented" role="radiogroup" aria-label="${q.label}" data-mount="segmented">${opts.map((o, i) => {
    const on = hasSel && String(o.value) === sel;
    const stop = stopSel ? on : i === firstOn;
    return html`<button type="button" role="radio" class="gk-segmented__opt${on ? " is-on" : ""}" aria-checked="${on ? "true" : "false"}" tabindex="${stop ? "0" : "-1"}" data-act="${q.act || "segmented:pick"}" data-v="${o.value}" data-k="${kk}-${o.value}"${o.disabled ? html` disabled` : ""}${o.tip ? html` data-tip="${o.tip}"` : ""}>${o.text || o.value}${o.tip ? html`<span class="sr-only">. ${o.tip}</span>` : ""}</button>`;
  })}</div>`;
}

/**
 * Arrow-key roving for a segmented radiogroup. Left/Up and Right/Down move to the previous or
 * next enabled radio (wrapping), Home and End to the first and last; the new radio takes focus
 * and is clicked, so the delegated segmented:pick handler runs as for a pointer.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const segmentedIsland = {
  mount(el) {
    /** @param {any} ev */
    const onKey = (ev) => {
      const key = ev.key;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].indexOf(key) < 0) return;
      /** @type {any[]} */
      const radios = Array.prototype.slice.call(el.querySelectorAll('[role="radio"]')).filter((r) => !r.hasAttribute("disabled"));
      if (!radios.length) return;
      const cur = radios.indexOf(ev.target && ev.target.closest ? ev.target.closest('[role="radio"]') : null);
      let next;
      if (key === "Home") next = 0;
      else if (key === "End") next = radios.length - 1;
      else if (key === "ArrowLeft" || key === "ArrowUp") next = cur <= 0 ? radios.length - 1 : cur - 1;
      else next = cur < 0 || cur === radios.length - 1 ? 0 : cur + 1;
      ev.preventDefault();
      if (cur === next) return;
      for (const r of radios) r.setAttribute("tabindex", "-1");
      radios[next].setAttribute("tabindex", "0");
      radios[next].focus();
      radios[next].click();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  },
};
