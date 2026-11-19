// Page-level block composed from shadcn/ui new-york v4 anatomy (MIT; see THIRD_PARTY_NOTICES.md),
// the app shell: a sidebar, and beside it an inset with a site header and the page body.
import { html } from "@gas-kit/client/html.js";
import { breadcrumb } from "../components/breadcrumb.js";
import { separator } from "../components/separator.js";
import { sidebar, sidebarInset, sidebarLayout, sidebarTrigger } from "../components/sidebar.js";

const VARIANTS = ["sidebar", "floating", "inset"];

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/**
 * @component appShell
 * @title App Shell
 * @category Application shell
 * @summary The app frame: a sidebar and, beside it, a site header (sidebar trigger, divider, breadcrumb or page title, right-aligned actions) over the page content.
 * @param {{sidebar: any, title: string, breadcrumb?: Array<{label?: string, href?: string, ellipsis?: boolean}>, actions?: unknown, content?: unknown, variant?: "sidebar"|"floating"|"inset", k?: string}} p
 * `sidebar` takes the props of the `sidebar` view (an `id` is required; the trigger finds the sidebar by it). `title` is the page title: the visible h1, or, when `breadcrumb` items are given, a screen-reader-only h1 beside the visible trail (the last item is the current page). `actions` is SafeHtml for the right of the header (typically ghost or outline buttons). `content` is the page, padded 16px (24px from 768px wide) and built by the app, for example with `dashboard` or `settingsLayout`. `variant` sets the sidebar and layout variant together (default: the sidebar's own, else "sidebar"); "inset" draws the page as a rounded card on the sidebar colour. `k` prefixes the trigger's data-k (default "<sidebar id>-trigger"). Mount the `sidebar` island (sidebarIsland) after every render; the trigger and Ctrl or Cmd plus B need it. Needs sidebar.css, sheet.css and button.css.
 * @emits sidebar:toggle (the trigger; the island handles it), plus the acts of the sidebar items and of `actions`
 * @states default, breadcrumb, actions, inset
 * @a11y The inset is a main landmark labelled "Content" and the sidebar a labelled nav. The page always has one h1. The trigger is a button with an sr-only name, aria-controls and aria-expanded, and it shows its name as a tip. The header row is a plain div, so the page keeps a single banner.
 * @example default: appShell({ title: "Overview", sidebar: { id: "shell-a", shortcut: false, header: "Acme", groups: [{ label: "Registry", items: [{ label: "Overview", href: "#overview", icon: "home", active: true }, { label: "Reports", href: "#reports", icon: "chart" }] }] }, content: "Page content." })
 * @example breadcrumb: appShell({ title: "Billing", breadcrumb: [{ label: "Settings", href: "#settings" }, { label: "Billing" }], sidebar: { id: "shell-b", shortcut: false, groups: [{ items: [{ label: "Settings", href: "#settings", icon: "settings", active: true }] }] }, content: "Invoices for Acme." })
 * @example actions: appShell({ title: "Documents", actions: "Share", sidebar: { id: "shell-c", shortcut: false, groups: [{ items: [{ label: "Documents", href: "#docs", icon: "file", active: true }] }] }, content: "No documents yet." })
 * @example inset: appShell({ title: "Overview", variant: "inset", sidebar: { id: "shell-d", shortcut: false, header: "Acme", groups: [{ items: [{ label: "Overview", href: "#overview", icon: "home", active: true }] }] }, content: "Page content." })
 */
export function appShell(p) {
  const q = p || /** @type {any} */ ({});
  /** @type {any} */
  const sb = q.sidebar && typeof q.sidebar === "object" ? q.sidebar : { id: "sidebar", groups: [] };
  const id = sb.id != null && sb.id !== "" ? String(sb.id) : "sidebar";
  const variant = /** @type {"sidebar"|"floating"|"inset"} */ (VARIANTS.indexOf(String(q.variant)) >= 0 ? String(q.variant) : VARIANTS.indexOf(String(sb.variant)) >= 0 ? String(sb.variant) : "sidebar");
  const trail = Array.isArray(q.breadcrumb) && q.breadcrumb.length ? q.breadcrumb : null;
  const title = has(q.title) ? q.title : "";
  const header = html`${sidebarTrigger({ controls: id, k: has(q.k) ? String(q.k) : undefined })}<span class="gk-appShell__divider">${separator({ orientation: "vertical" })}</span>${
    trail ? html`<h1 class="sr-only">${title}</h1>${breadcrumb({ items: trail })}` : html`<h1 class="gk-appShell__title">${title}</h1>`
  }${has(q.actions) ? html`<div class="gk-appShell__actions">${q.actions}</div>` : ""}`;
  const side = sidebar({ ...sb, id, variant });
  return sidebarLayout({
    variant,
    content: html`${side}${sidebarInset({ header, content: html`<div class="gk-appShell__body">${has(q.content) ? q.content : ""}</div>` })}`,
  });
}
