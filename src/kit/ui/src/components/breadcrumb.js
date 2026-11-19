// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html, attrs, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";

/**
 * @component breadcrumb
 * @title Breadcrumb
 * @category Navigation
 * @summary A trail of links to the current page, with an optional ellipsis for collapsed levels.
 * @param {{items: {label?: string, href?: string, ellipsis?: boolean}[], ariaLabel?: string, k?: string}} p
 * `items` run from the root to the current page; the last one is the current page and is never a link. An item with `ellipsis: true` shows a "..." with the sr-only text "More pages" (its `label` overrides it). An item whose `href` is missing or fails `isSafeUrl` (only http, https, mailto and relative URLs pass) is plain text, not a link. `ariaLabel` names the nav (default "Breadcrumb").
 * @emits none
 * @states default, ellipsis, single
 * @a11y A nav with an aria-label around an ordered list; the current page has aria-current="page"; the chevron separators are aria-hidden list items with role="presentation". Links are native anchors with the kit focus ring.
 * @example default: breadcrumb({ items: [{ label: "Home", href: "/" }, { label: "Registers", href: "/registers" }, { label: "Acme" }] })
 * @example ellipsis: breadcrumb({ items: [{ label: "Home", href: "/" }, { ellipsis: true }, { label: "Registers", href: "/registers" }, { label: "Acme" }] })
 * @example single: breadcrumb({ items: [{ label: "Home" }] })
 */
export function breadcrumb(p) {
  const q = p || { items: [] };
  const items = Array.isArray(q.items) ? q.items : [];
  const chevron = html`<li class="gk-breadcrumb__sep" role="presentation" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="m9 6 6 6-6 6"></path></svg></li>`;
  return html`<nav class="gk-breadcrumb" aria-label="${q.ariaLabel != null && q.ariaLabel !== "" ? q.ariaLabel : "Breadcrumb"}"${q.k != null && q.k !== "" ? html` data-k="${q.k}"` : ""}><ol class="gk-breadcrumb__list">${items.map((it, i) => {
    const last = i === items.length - 1;
    const sep = i > 0 ? chevron : "";
    if (it != null && it.ellipsis === true) {
      return html`${sep}<li class="gk-breadcrumb__item"><span class="gk-breadcrumb__ellipsis"><span aria-hidden="true">...</span><span class="sr-only">${it.label != null && it.label !== "" ? it.label : "More pages"}</span></span></li>`;
    }
    const text = it != null && it.label != null ? it.label : "";
    if (last) return html`${sep}<li class="gk-breadcrumb__item"><span class="gk-breadcrumb__page" aria-current="page">${text}</span></li>`;
    if (it != null && it.href != null && it.href !== "" && isSafeUrl(it.href)) {
      return html`${sep}<li class="gk-breadcrumb__item"><a ${attrs({ class: "gk-breadcrumb__link", ...linkAttrs(it.href) })}>${text}</a></li>`;
    }
    return html`${sep}<li class="gk-breadcrumb__item"><span class="gk-breadcrumb__text">${text}</span></li>`;
  })}</ol></nav>`;
}
