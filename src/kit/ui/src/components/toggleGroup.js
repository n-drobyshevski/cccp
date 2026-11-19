// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A joined row of toggles. Single mode is a radiogroup with a roving tab stop (arrow keys need
// toggleGroupIsland); multiple mode is a group of aria-pressed buttons in the normal tab order.
import { html, attrs } from "@gas-kit/client/html.js";
import { toggleAttrs } from "./toggle.js";

/**
 * @component toggleGroup
 * @title Toggle Group
 * @category Forms
 * @summary A joined set of toggle buttons: pick one (a radiogroup) or any number.
 * @param {{label: string, items: Array<{value: string, text?: string, content?: unknown, ariaLabel?: string, tip?: string, disabled?: boolean}>, type?: "single"|"multiple", value?: string|string[]|null, variant?: "default"|"outline", size?: "sm"|"default"|"lg", k?: string, act?: string}} p
 * `type` is "single" (default) or "multiple". `value` is the selected value (single) or the array of selected values (multiple). `k` prefixes each button's data-k ("<k>-<value>", default "tg"; give every group on a page its own); `act` defaults to "toggleGroup:toggle" and each button carries data-v. In single mode the app sets the value; clicking the selected item again is for the app to ignore or clear. Mount toggleGroupIsland after every render of a single group, or only the arrow keys stop working.
 * @emits toggleGroup:toggle (data-v, data-k; or the act you pass)
 * @states single, multiple, outline, empty
 * @a11y Single: role="radiogroup" with a label; each button is role="radio" with aria-checked, and only the selected enabled one (or the first enabled one when none is selected) is in the tab order; the island moves with Arrow keys, Home and End and picks as it goes. Multiple: role="group" with a label and aria-pressed on each button, all in the tab order. Selected buttons use a fill, a heavier weight and an inset outline, never colour alone.
 * @example single: toggleGroup({ label: "Align", k: "al", value: "center", items: [{ value: "left", text: "Left" }, { value: "center", text: "Center" }, { value: "right", text: "Right" }] })
 * @example multiple: toggleGroup({ label: "Format", type: "multiple", k: "fmt", value: ["bold", "italic"], items: [{ value: "bold", text: "Bold" }, { value: "italic", text: "Italic" }, { value: "under", text: "Underline" }] })
 * @example outline: toggleGroup({ label: "View", variant: "outline", size: "sm", k: "vw", value: "list", items: [{ value: "list", text: "List" }, { value: "grid", text: "Grid" }] })
 * @example empty: toggleGroup({ label: "Format", k: "fmt-e", items: [] })
 */
export function toggleGroup(p) {
  const q = p || { label: "", items: [] };
  const items = Array.isArray(q.items) ? q.items : [];
  const multi = q.type === "multiple";
  const kk = q.k != null && q.k !== "" ? String(q.k) : "tg";
  const picked = Array.isArray(q.value) ? q.value.map(String) : q.value == null ? [] : [String(q.value)];
  const isOn = (/** @type {any} */ it) => picked.indexOf(String(it.value)) >= 0;
  const selIdx = items.findIndex((it) => isOn(it) && !it.disabled);
  const stopIdx = selIdx >= 0 ? selIdx : items.findIndex((it) => !it.disabled);
  return html`<div ${attrs({ class: "gk-toggleGroup", role: multi ? "group" : "radiogroup", "aria-label": q.label, "data-variant": q.variant === "outline" ? "outline" : "default", "data-mount": multi ? null : "toggleGroup" })}>${items.map((it, i) => {
    const on = isOn(it);
    return html`<button ${attrs({
      ...toggleAttrs({ ...q, ariaLabel: it.ariaLabel, tip: it.tip, disabled: it.disabled }),
      role: multi ? null : "radio", "aria-pressed": multi ? (on ? "true" : "false") : null, "aria-checked": multi ? null : on ? "true" : "false",
      tabindex: multi ? null : i === stopIdx ? "0" : "-1", "data-pressed": on ? "1" : null,
      "data-act": q.act || "toggleGroup:toggle", "data-v": it.value, "data-k": kk + "-" + it.value,
    })}>${it.content != null ? it.content : it.text != null ? it.text : it.value}${it.tip ? html`<span class="sr-only">. ${it.tip}</span>` : ""}</button>`;
  })}</div>`;
}

/**
 * Arrow-key roving for a single-mode toggle group. Left/Up and Right/Down move to the previous
 * or next enabled radio (wrapping), Home and End to the ends; the new radio takes focus and is
 * clicked, so the delegated toggleGroup:toggle handler runs as for a pointer.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const toggleGroupIsland = {
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
