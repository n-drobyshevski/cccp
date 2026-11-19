// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A button or link button. The shared class is gk-btn with data-variant and data-size; other
// components adopt it for their own controls.
import { html, attrs, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"];
const SIZES = ["sm", "default", "lg", "icon"];

/**
 * @component button
 * @title Button
 * @category Forms
 * @summary A button or link button in six variants and four sizes, with a loading state.
 * @param {{label?: string, content?: unknown, variant?: "default"|"secondary"|"outline"|"ghost"|"destructive"|"link", size?: "sm"|"default"|"lg"|"icon", href?: string, newTab?: boolean, type?: "button"|"submit"|"reset", loading?: boolean, disabled?: boolean, ariaLabel?: string, tip?: string, act?: string, k?: string, v?: string}} p
 * `label` is plain text; `content` is SafeHtml (an icon plus text) and wins over `label`. An icon-only button (`size: "icon"`) needs `ariaLabel`. With `href` (http, https, mailto or relative) the view renders an anchor; an unsafe `href` is dropped and the view renders a disabled button instead. An absolute or mailto `href` opens in the top window (target="_top", since the app runs in a frame), or in a new tab with `newTab: true`, and carries rel="noopener noreferrer"; a hash or relative `href` carries neither. `act`, `k` and `v` go to `data-act`, `data-k` and `data-v`. `type` defaults to "button". Unknown `variant` and `size` fall back to the default. The shared classes: `gk-btn` carries `data-variant` and `data-size`, so another component can write class="gk-btn" data-variant="outline" data-size="sm" on its own element and get the whole look.
 * @emits button:click (the act you pass; data-k, data-v)
 * @states default, secondary, outline, ghost, destructive, link, loading, disabled, link-button
 * @a11y A native button, or an anchor when `href` is set. Loading sets aria-busy and aria-disabled and keeps focus, with a spinner that is aria-hidden; the label stays the name. A disabled button without a tip uses the native attribute; with a tip it uses aria-disabled plus data-disabled so it stays focusable and its tip is reachable (the app must ignore its act). The tip is also sr-only text inside the control. Variants differ by fill, border and weight, never colour alone: destructive is named by its label. The focus ring is the kit style from base.css. Motion: colours ease over --dur-2; the press scale comes from base.css.
 * @example default: button({ label: "Save changes", act: "form:save", k: "btn-save" })
 * @example secondary: button({ label: "Cancel", variant: "secondary", act: "form:cancel", k: "btn-cancel" })
 * @example outline: button({ label: "Export", variant: "outline", size: "sm", act: "table:export", k: "btn-export" })
 * @example ghost: button({ label: "Dismiss", variant: "ghost", act: "note:dismiss", k: "btn-dismiss" })
 * @example destructive: button({ label: "Delete", variant: "destructive", act: "item:delete", k: "btn-delete", v: "42" })
 * @example link: button({ label: "Learn more", variant: "link", act: "help:open", k: "btn-learn" })
 * @example loading: button({ label: "Saving", loading: true, act: "form:save", k: "btn-saving" })
 * @example disabled: button({ label: "Submit", disabled: true, tip: "Fill in the form first", act: "form:submit", k: "btn-submit" })
 * @example link-button: button({ label: "Open docs", href: "/docs", variant: "outline", k: "btn-docs" })
 */
export function button(p) {
  const q = p || {};
  const variant = VARIANTS.indexOf(String(q.variant)) >= 0 ? String(q.variant) : "default";
  const size = SIZES.indexOf(String(q.size)) >= 0 ? q.size : "default";
  const tip = q.tip != null && q.tip !== "" ? q.tip : null;
  const hasHref = q.href != null && q.href !== "";
  const safeHref = hasHref && isSafeUrl(q.href);
  const loading = q.loading === true;
  const off = q.disabled === true || (hasHref && !safeHref);
  const soft = loading || (off && tip != null);
  const body = html`${loading ? html`<svg class="gk-btn__spinner" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>` : ""}${q.content != null ? q.content : q.label != null ? q.label : ""}${tip && off ? html`<span class="sr-only">. ${tip}</span>` : ""}`;
  const common = {
    class: "gk-btn",
    "data-variant": variant,
    "data-size": size,
    "aria-label": q.ariaLabel != null && q.ariaLabel !== "" ? q.ariaLabel : null,
    "aria-busy": loading ? "true" : null,
    "aria-disabled": soft || (off && safeHref) ? "true" : null,
    "data-disabled": soft || (off && safeHref) ? "true" : null,
    "data-tip": tip,
    "data-act": q.act != null && q.act !== "" ? q.act : null,
    "data-k": q.k != null && q.k !== "" ? q.k : null,
    "data-v": q.v != null ? q.v : null,
  };
  if (safeHref && !off) {
    return html`<a ${attrs({ ...linkAttrs(q.href, { newTab: q.newTab === true }), ...common })}>${body}</a>`;
  }
  if (safeHref && off) {
    // A disabled link has no href, so it cannot be followed; it stays in the tab order only through role and aria-disabled.
    return html`<a ${attrs({ role: "link", ...common })}>${body}</a>`;
  }
  return html`<button ${attrs({ type: ["button", "submit", "reset"].indexOf(String(q.type)) >= 0 ? q.type : "button", ...common, disabled: off && !soft })}>${body}</button>`;
}
