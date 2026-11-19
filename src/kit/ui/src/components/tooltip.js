// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A tooltip trigger: a gk-btn carrying data-tip. The card itself is drawn by the client tip
// layer (installTips from @gas-kit/client/tip.js, styled by tip.css), so this module has no
// stylesheet and no listener. The tip text is always also the accessible name or in it.
import { html } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { button } from "./button.js";

/** Whether two texts read the same (case and runs of white space ignored). @param {unknown} a @param {unknown} b */
const same = (a, b) => String(a).trim().replace(/\s+/g, " ").toLowerCase() === String(b).trim().replace(/\s+/g, " ").toLowerCase();

/**
 * @component tooltip
 * @title Tooltip
 * @category Overlays
 * @summary A button that shows a short text tip on hover and on keyboard focus.
 * @param {{text: string, label?: string, content?: unknown, icon?: string, variant?: "default"|"secondary"|"outline"|"ghost"|"destructive"|"link", size?: "sm"|"default"|"lg"|"icon", k?: string, v?: string, act?: string}} p
 * `text` is the tip, written to `data-tip`. The trigger is a `button` (variant default "outline", size default "default"; "icon" is allowed). `label` is plain text and is escaped; `content` is SafeHtml and wins over `label` and `icon`; `icon` is a name from the client icon set (`ICON_NAMES` in @gas-kit/client/icons.js). With `icon` and no `label` the size defaults to "icon". `act`, `k` and `v` go to `data-act`, `data-k` and `data-v`. The app installs the tip layer once, `installTips(document)` from @gas-kit/client/tip.js, and ships tip.css, which styles the card (the manifest lists it in cssDeps); without the layer the trigger is a plain button with the same name.
 * @emits tooltip:click (the act you pass; data-k, data-v)
 * @states default, icon-only, long-text
 * @a11y The card opens on hover and on keyboard focus and closes on Escape (tip.js); it is a courtesy copy, never the only one. An icon-only trigger (size "icon") gets the tip as its aria-label. A trigger with a visible label keeps it as the name, and when the tip says something else the tip follows as sr-only text, so it is read too. Any other trigger (no label, or SafeHtml content) carries the tip as sr-only text, or shows it as the label when it has nothing else. No title attribute and no static aria-describedby.
 * @example default: tooltip({ text: "Add to library", label: "Hover", act: "library:add", k: "tt-add" })
 * @example icon-only: tooltip({ text: "Copy link", icon: "copy", act: "link:copy", k: "tt-copy" })
 * @example long-text: tooltip({ text: "Exports every row that matches the current filters, not only the rows on this page. Large registers can take a minute.", label: "Export", act: "table:export", k: "tt-export" })
 */
export function tooltip(p) {
  const q = p || { text: "" };
  const has = (/** @type {unknown} */ x) => x != null && x !== "";
  const text = has(q.text) ? String(q.text) : null;
  const glyph = has(q.icon) ? icon(String(q.icon), 16) : null;
  const iconOnly = q.size === "icon" || (q.size == null && glyph !== null && q.content == null && !has(q.label));
  const size = iconOnly ? "icon" : q.size;
  const tipSpan = text ? html`<span class="sr-only">. ${text}</span>` : "";
  /** @type {unknown} */
  let content;
  if (iconOnly) {
    content = q.content != null ? q.content : glyph !== null ? glyph : has(q.label) ? q.label : "";
  } else if (q.content != null) {
    content = html`${q.content}${tipSpan}`;
  } else if (has(q.label)) {
    content = html`${glyph}${q.label}${text && !same(q.label, text) ? tipSpan : ""}`;
  } else {
    content = html`${glyph}${text || ""}`;
  }
  return button({
    content,
    variant: q.variant != null ? q.variant : "outline",
    size: /** @type {any} */ (size),
    ariaLabel: iconOnly && text ? text : undefined,
    tip: text || undefined,
    act: q.act,
    k: q.k,
    v: q.v,
  });
}
