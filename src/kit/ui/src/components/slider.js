// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A native range input with a label and a value read-out. sliderIsland keeps the filled part
// and the read-out in step while dragging; mount it with mountIslands(root, { slider: sliderIsland }).
import { html, attrs, styleDecls } from "@gas-kit/client/html.js";

/** @param {unknown} v @param {number} d */
const num = (v, d) => (v != null && v !== "" && isFinite(Number(v)) ? Number(v) : d);

/**
 * @component slider
 * @title Slider
 * @category Forms
 * @summary A range slider with a label and the current value shown next to it.
 * @param {{id: string, label: string, value?: number, min?: number, max?: number, step?: number, unit?: string, name?: string, disabled?: boolean, showValue?: boolean, act?: string, k?: string}} p
 * `min` defaults to 0, `max` to 100, `step` to 1; `value` is clamped into the range (default `min`). `unit` is appended to the read-out ("%", " days"). `act` goes to data-act on the input (the delegated "input" event, so the app sees every move; use a "change" delegate to see only the drop); `k` becomes data-k. `showValue: false` hides the read-out. Mount sliderIsland after every render, or the filled track does not follow the thumb between renders.
 * @emits the act you pass, on input (the value is the input's value)
 * @states default, stepped, unit, disabled
 * @a11y A native input type=range: arrow keys, Home, End and Page keys work with no script; the thumb carries the value and aria-valuetext with the unit. The label is a native label tied by id, and the read-out is an output element for the same input. The filled track and the thumb position show the value, so it is not colour alone. The focus ring is a 2px accent outline around the thumb.
 * @example default: slider({ id: "sl-volume", label: "Volume", value: 40, act: "slider:set", k: "sl-volume" })
 * @example stepped: slider({ id: "sl-step", label: "Retention", value: 30, min: 0, max: 90, step: 30, unit: " days" })
 * @example unit: slider({ id: "sl-pct", label: "Threshold", value: 75, unit: "%" })
 * @example disabled: slider({ id: "sl-off", label: "Locked", value: 20, disabled: true })
 */
export function slider(p) {
  const q = p || { id: "slider", label: "" };
  const min = num(q.min, 0);
  const max = Math.max(min, num(q.max, 100));
  const step = num(q.step, 1) > 0 ? num(q.step, 1) : 1;
  const v = Math.min(max, Math.max(min, num(q.value, min)));
  const pct = max > min ? Math.round(((v - min) / (max - min)) * 1000) / 10 : 0;
  const unit = q.unit != null ? q.unit : "";
  const id = q.id != null && q.id !== "" ? String(q.id) : "slider";
  return html`<div class="gk-slider"><div class="gk-slider__head"><label class="gk-label" for="${id}">${q.label}</label>${q.showValue === false ? "" : html`<output class="gk-slider__value" for="${id}">${v}${unit}</output>`}</div><input ${attrs({
    type: "range", id, class: "gk-slider__input", name: q.name || null, min, max, step, value: v, style: styleDecls({ "--gk-pct": pct }),
    "aria-valuetext": v + unit, disabled: q.disabled === true, "data-act": q.act || null, "data-k": q.k || null, "data-unit": unit || null, "data-mount": "slider",
  })}></div>`;
}

/**
 * Keeps --gk-pct (the filled track) and the read-out in step with the input while it moves.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const sliderIsland = {
  mount(el) {
    const inp = /** @type {any} */ (el);
    const out = el.parentElement ? el.parentElement.querySelector(".gk-slider__value") : null;
    const sync = () => {
      const min = Number(inp.min || 0);
      const max = Number(inp.max || 100);
      const v = Number(inp.value);
      const pct = max > min ? Math.round(((v - min) / (max - min)) * 1000) / 10 : 0;
      el.setAttribute("style", "--gk-pct:" + pct);
      const unit = el.getAttribute("data-unit") || "";
      el.setAttribute("aria-valuetext", v + unit);
      if (out) out.textContent = v + unit;
    };
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  },
};
