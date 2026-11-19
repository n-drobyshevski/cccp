// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A row or column of related buttons joined into one control. The children are ordinary kit
// buttons (button.js); the shared class gk-btnGroup joins any gk-btn elements written by hand.
import { html, attrs } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { button } from "./button.js";

const SIZES = ["sm", "default", "lg"];

/**
 * @component buttonGroup
 * @title Button Group
 * @category Forms
 * @summary Related buttons joined into one row or column with shared borders.
 * @param {{label: string, buttons: Array<{label?: string, content?: unknown, icon?: string, variant?: "default"|"secondary"|"outline"|"ghost"|"destructive"|"link", size?: "sm"|"default"|"lg"|"icon", href?: string, loading?: boolean, disabled?: boolean, ariaLabel?: string, tip?: string, act?: string, k?: string, v?: string}>, orientation?: "horizontal"|"vertical", size?: "sm"|"default"|"lg"}} p
 * `label` names the group (aria-label). Each entry of `buttons` takes the `button` props; `variant` defaults to "outline". `icon` is a name from the client icon set, drawn before the label; an entry with `icon` and no `label` is an icon button (size "icon") and needs `ariaLabel` (or `tip`, which is then also the name). `size` (sm, default or lg) goes to every button that does not ask for "icon", and to `data-size` on the group, which sizes the icon buttons to match. `orientation` is horizontal (default) or vertical. The shared class: write div class="gk-btnGroup" role="group" aria-label="..." around your own gk-btn elements; data-orientation="vertical" stacks them.
 * @emits buttonGroup:click (each button's own act; data-k, data-v)
 * @states default, vertical, with-icon
 * @a11y A div with role group and an aria-label, holding native buttons that stay in the tab order one by one. Neighbours share one border; a focused button is raised above its neighbours so the whole 2px var(--accent) ring shows. Icon buttons are named by aria-label.
 * @example default: buttonGroup({ label: "Text alignment", buttons: [{ label: "Left", act: "align:set", v: "left", k: "bg-left" }, { label: "Center", act: "align:set", v: "center", k: "bg-center" }, { label: "Right", act: "align:set", v: "right", k: "bg-right" }] })
 * @example vertical: buttonGroup({ label: "Zoom", orientation: "vertical", size: "sm", buttons: [{ label: "Zoom in", act: "zoom:in", k: "bg-zin" }, { label: "Zoom out", act: "zoom:out", k: "bg-zout" }, { label: "Reset", act: "zoom:reset", k: "bg-zreset" }] })
 * @example with-icon: buttonGroup({ label: "Share", buttons: [{ label: "Copy link", icon: "link", act: "share:copy", k: "bg-copy" }, { icon: "download", ariaLabel: "Download", tip: "Download", act: "share:download", k: "bg-download" }] })
 */
export function buttonGroup(p) {
  const q = p || { label: "", buttons: [] };
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  const list = Array.isArray(q.buttons) ? q.buttons : [];
  const size = SIZES.indexOf(String(q.size)) >= 0 ? q.size : null;
  const vertical = q.orientation === "vertical";
  const items = list.map((b) => {
    const o = b || {};
    const glyph = has(o.icon) ? icon(String(o.icon), 16) : null;
    const iconOnly = glyph !== null && o.content == null && !has(o.label);
    const own = iconOnly ? "icon" : o.size;
    return button({
      ...o,
      content: o.content != null ? o.content : glyph !== null ? html`${glyph}${has(o.label) ? o.label : ""}` : undefined,
      variant: o.variant != null ? o.variant : "outline",
      size: own === "icon" ? "icon" : size != null ? size : own,
      ariaLabel: has(o.ariaLabel) ? o.ariaLabel : iconOnly && has(o.tip) ? o.tip : undefined,
    });
  });
  return html`<div ${attrs({
    class: "gk-btnGroup",
    role: "group",
    "aria-label": has(q.label) ? q.label : null,
    "data-orientation": vertical ? "vertical" : "horizontal",
    "data-size": size,
  })}>${items}</div>`;
}
