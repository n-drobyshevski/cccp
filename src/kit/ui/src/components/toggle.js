// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A two-state button. It reuses gk-btn (ghost for default, outline for outline) and adds the
// pressed look; the app keeps the state and re-renders on the act.
import { html, attrs } from "@gas-kit/client/html.js";

const SIZES = ["sm", "default", "lg"];

/**
 * The attributes shared by toggle and toggleGroup buttons.
 * @internal
 * @param {any} q
 * @returns {Record<string, unknown>}
 */
export function toggleAttrs(q) {
  const outline = q.variant === "outline";
  const size = SIZES.indexOf(String(q.size)) >= 0 ? q.size : "default";
  return {
    type: "button", class: "gk-btn gk-toggle", "data-variant": outline ? "outline" : "ghost", "data-size": size,
    "data-toggle": outline ? "outline" : "default", "aria-label": q.ariaLabel || null, "data-tip": q.tip || null,
    disabled: q.disabled === true,
  };
}

/**
 * @component toggle
 * @title Toggle
 * @category Forms
 * @summary A button that is either pressed or not, in a plain or an outlined style.
 * @param {{text?: string, content?: unknown, pressed?: boolean, variant?: "default"|"outline", size?: "sm"|"default"|"lg", ariaLabel?: string, tip?: string, disabled?: boolean, act?: string, k?: string, v?: string}} p
 * `text` is plain text; `content` is SafeHtml (an icon, with or without text) and wins over `text`. An icon-only toggle needs `ariaLabel`. `act` defaults to "toggle:toggle"; the button carries data-k and data-v, and the app flips `pressed` and re-renders. `tip` is shown on hover and focus and is also sr-only text inside the button.
 * @emits toggle:toggle (data-k, data-v; or the act you pass)
 * @states off, on, outline, outline-on, disabled
 * @a11y A native button with aria-pressed, so a screen reader says "toggle button, pressed". The pressed state is a filled background, a heavier weight and an inset outline, never colour alone. The focus ring is the kit style from base.css. Motion: colours ease over --dur-2 from gk-btn.
 * @example on: toggle({ text: "Bold", pressed: true, k: "tg-bold-on", v: "bold" })
 * @example off: toggle({ text: "Bold", k: "tg-bold", v: "bold" })
 * @example outline: toggle({ text: "Italic", variant: "outline", k: "tg-ital", v: "italic" })
 * @example outline-on: toggle({ text: "Italic", variant: "outline", pressed: true, k: "tg-ital-on", v: "italic" })
 * @example disabled: toggle({ text: "Underline", disabled: true, k: "tg-under", v: "underline" })
 */
export function toggle(p) {
  const q = p || {};
  const on = q.pressed === true;
  return html`<button ${attrs({ ...toggleAttrs(q), "aria-pressed": on ? "true" : "false", "data-act": q.act || "toggle:toggle", "data-k": q.k || null, "data-v": q.v != null ? q.v : null })}>${q.content != null ? q.content : q.text != null ? q.text : ""}${q.tip ? html`<span class="sr-only">. ${q.tip}</span>` : ""}</button>`;
}
