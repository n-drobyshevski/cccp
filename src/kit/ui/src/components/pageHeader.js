// Extracted from the author's production Apps Script apps; adapted.
// The top of a page: optional breadcrumb, eyebrow, the one h1, a description and an actions
// slot. Actions are descriptors (buttons with data-act, or links) or ready SafeHtml.
import { attrs, html, isSafe, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";

/**
 * @param {any} a
 * @param {number} i
 */
function action(a, i) {
  if (isSafe(a)) return a;
  const primary = a.variant === "primary";
  const cls = "gk-page-header__action gk-btn" + (primary ? " is-primary" : "");
  const variant = primary ? "default" : "outline";
  if (a.href) {
    // An unsafe href drops the link: plain text, never a throw from the view.
    if (!isSafeUrl(a.href)) return html`<span class="${cls} is-text" data-variant="${variant}">${a.label}</span>`;
    return html`<a class="${cls}" data-variant="${variant}" ${attrs({ ...linkAttrs(a.href), "data-k": a.k || "page-action-" + i })}>${a.label}</a>`;
  }
  return html`<button type="button" class="${cls}" data-variant="${variant}" ${attrs({ "data-act": a.act, "data-k": a.k || "page-action-" + i, "data-tip": a.tip, "aria-label": a.tip ? a.label + ". " + a.tip : null })}>${a.label}</button>`;
}

/**
 * @component pageHeader
 * @title Page Header
 * @category Layout
 * @summary The page title (h1) with an optional eyebrow, breadcrumb, description and action buttons.
 * @param {{title: string, eyebrow?: string|null, description?: string|null, breadcrumbs?: Array<{label: string, href?: string|null}>|null, actions?: Array<any>|null}} p
 * @emits the actions' own data-act values
 * @states default, withBreadcrumb, withActions
 * @a11y Motion: action colours ease over --dur-2; the press scale comes from base.css. Reduced motion drops the press scale only. One h1 per page. The breadcrumb is a nav labelled Breadcrumb holding an ordered list; separators are aria-hidden spans; the last crumb carries aria-current=page (on its link when it has a safe href, else on the list item). A breadcrumb or link action with an unsafe href (such as javascript:) is rendered as plain text, never as a link, and never throws. An action's data-tip text is repeated in its aria-label.
 * @example default: pageHeader({ title: "Applications", eyebrow: "Register", description: "Every record in one place." })
 * @example withBreadcrumb: pageHeader({ title: "Acme Portal", breadcrumbs: [{ label: "Applications", href: "#/apps" }, { label: "Acme Portal" }] })
 * @example withActions: pageHeader({ title: "Applications", actions: [{ label: "Export", act: "page:export", tip: "Download as CSV" }, { label: "Add", act: "page:add", variant: "primary" }] })
 */
export function pageHeader(p) {
  const crumbs = p.breadcrumbs && p.breadcrumbs.length ? p.breadcrumbs : null;
  const list = (p.actions || []).filter(Boolean);
  const acts = list.length ? list : null;
  return html`<header class="gk-page-header">${
    crumbs ? html`<nav class="gk-page-header__crumbs" aria-label="Breadcrumb"><ol>${crumbs.map(/** @param {any} c @param {number} i */ (c, i) =>
      i === crumbs.length - 1
        ? (isSafeUrl(c.href)
          ? html`<li class="gk-page-header__crumb"><a ${attrs({ ...linkAttrs(c.href), "data-k": "crumb-" + i, "aria-current": "page" })}>${c.label}</a></li>`
          : html`<li class="gk-page-header__crumb" aria-current="page">${c.label}</li>`)
        : html`<li class="gk-page-header__crumb">${isSafeUrl(c.href) ? html`<a ${attrs({ ...linkAttrs(c.href), "data-k": "crumb-" + i })}>${c.label}</a>` : c.label}<span class="gk-page-header__sep" aria-hidden="true">/</span></li>`)}</ol></nav>` : null
  }<div class="gk-page-header__row"><div class="gk-page-header__text">${
    p.eyebrow ? html`<p class="gk-page-header__eyebrow">${p.eyebrow}</p>` : null
  }<h1 class="gk-page-header__title">${p.title}</h1>${
    p.description ? html`<p class="gk-page-header__desc">${p.description}</p>` : null
  }</div>${acts ? html`<div class="gk-page-header__actions">${acts.map(action)}</div>` : null}</div></header>`;
}
