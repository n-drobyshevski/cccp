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
 * @param {{sidebar: any, title: string, breadcrumb?: Array<{label?: string, href?: string, ellipsis?: boolean}>, actions?: unknown, content?: unknown, variant?: "sidebar"|"floating"|"inset", headingLevel?: 1|2|3, k?: string}} p
 * `sidebar` takes the props of the `sidebar` view (an `id` is required; the trigger finds the sidebar by it). `title` is the page title: the visible h1, or, when `breadcrumb` items are given, a screen-reader-only h1 beside the visible trail (the last item is the current page). `actions` is SafeHtml for the right of the header (typically ghost or outline buttons). `content` is the page, padded 16px (24px from 768px wide) and built by the app, for example with `dashboard` or `settingsLayout`. `variant` sets the sidebar and layout variant together (default: the sidebar's own, else "sidebar"); "inset" draws the page as a rounded card on the sidebar colour. `headingLevel` (1, 2 or 3; default 1) is the level of the title heading: pass 2 when the page that embeds the shell already owns the h1, such as a docs page showing the block. `k` prefixes the trigger's data-k (default "<sidebar id>-trigger"). Mount the `sidebar` island (sidebarIsland) after every render; the trigger and Ctrl or Cmd plus B need it. Needs sidebar.css, sheet.css and button.css.
 * @emits sidebar:toggle (the trigger; the island handles it), plus the acts of the sidebar items and of `actions`
 * @states default, breadcrumb, actions, inset
 * @a11y The inset is a main landmark labelled "Content" and the sidebar a labelled nav. The page has one h1 at the default `headingLevel`; at 2 or 3 the title is that heading level instead, for a shell embedded in a page that owns the h1. The trigger is a button with an sr-only name, aria-controls and aria-expanded, and it shows its name as a tip. The header row is a plain div, so the page keeps a single banner.
 * @example default: appShell({ title: "Overview", headingLevel: 2, actions: button({ label: "Export", variant: "outline", size: "sm", act: "shell:export", k: "shell-a-export" }), sidebar: { id: "shell-a", shortcut: false, collapsible: "icon", header: "Acme Registry", footer: item({ title: "Dana Reyes", description: "dana@example.org", size: "sm", media: { avatar: { name: "Dana Reyes" } } }), groups: [{ label: "Platform", items: [{ label: "Overview", href: "#overview", icon: "home", active: true }, { label: "Inbox", href: "#inbox", icon: "inbox", badge: 12 }, { label: "Reports", icon: "chart", open: true, items: [{ label: "Weekly", href: "#weekly" }, { label: "Quarterly", href: "#quarterly" }] }] }, { label: "Workspace", items: [{ label: "Teams", href: "#teams", icon: "users" }, { label: "Documents", href: "#documents", icon: "folder" }, { label: "Settings", href: "#settings", icon: "settings" }] }] }, content: dashboard({ k: "shell-a-dash", cards: [{ label: "Active systems", value: 1240, trend: { value: 2.4 }, note: "Growing this quarter", sub: "Across 14 business units" }, { label: "Reviews due", value: 38, trend: { value: -12 }, note: "Down 12% on last month", sub: "Due in the next 30 days" }, { label: "Open requests", value: 17, trend: { value: 0 }, note: "Steady", sub: "Waiting on owners" }, { label: "Coverage", value: "96.4%", trend: { value: 1.1 }, note: "Above the 95% target", sub: "Systems with an owner" }], chart: { title: "Reviews completed", description: "Last 6 months", data: [{ m: "Jun", d: 31, e: 12 }, { m: "Jul", d: 44, e: 18 }, { m: "Aug", d: 38, e: 15 }, { m: "Sep", d: 52, e: 21 }, { m: "Oct", d: 47, e: 19 }, { m: "Nov", d: 58, e: 24 }], xKey: "m", series: [{ key: "d", label: "Standard", color: "chart-1" }, { key: "e", label: "Expedited", color: "chart-2" }], stacked: true }, tabs: { label: "Views", value: "recent", tabs: [{ value: "recent", text: "Recent reviews" }, { value: "due", text: "Due soon" }] }, table: { caption: "Recent reviews", columns: [{ key: "name", label: "System", sortable: true }, { key: "owner", label: "Owner" }, { key: "when", label: "Reviewed" }], rows: [{ name: "Acme Billing", owner: "Dana Reyes", when: "2026-11-12" }, { name: "Acme Mail Relay", owner: "Sam Okafor", when: "2026-11-10" }, { name: "Acme Payroll", owner: "Alex Lee", when: "2026-11-07" }] } }) })
 * @example breadcrumb: appShell({ title: "Billing", breadcrumb: [{ label: "Settings", href: "#settings" }, { label: "Billing" }], sidebar: { id: "shell-b", shortcut: false, groups: [{ items: [{ label: "Settings", href: "#settings", icon: "settings", active: true }] }] }, content: settingsLayout({ k: "shell-b-set", title: "Billing", description: "Invoices and payment method for Acme.", nav: [{ label: "Plan", href: "#plan" }, { label: "Invoices", href: "#invoices", active: true }], content: formSection({ title: "Invoices", description: "Download past invoices.", content: itemGroup({ label: "Recent invoices", separated: true, items: [{ title: "INV-1042", description: "2026-10-01, paid", media: { icon: "table" } }, { title: "INV-1031", description: "2026-09-01, paid", media: { icon: "table" } }] }) }) }) })
 * @example actions: appShell({ title: "Documents", actions: [button({ label: "Share", variant: "outline", size: "sm", act: "shell:share", k: "shell-c-share" }), button({ label: "New", size: "sm", act: "shell:new", k: "shell-c-new" })], sidebar: { id: "shell-c", shortcut: false, groups: [{ items: [{ label: "Documents", href: "#docs", icon: "file", active: true }] }] }, content: emptyState({ media: { icon: "plus" }, title: "No documents yet", body: "Create a document or import one from a file.", actions: [{ act: "docs:new", label: "Create document", k: "shell-c-create" }] }) })
 * @example inset: appShell({ title: "Overview", variant: "inset", sidebar: { id: "shell-d", shortcut: false, header: "Acme", groups: [{ items: [{ label: "Overview", href: "#overview", icon: "home", active: true }, { label: "Reports", href: "#reports", icon: "chart" }] }] }, content: sectionCards({ k: "shell-d-cards", cards: [{ label: "Open items", value: 42, trend: { value: -3 }, note: "Down 3% this week", sub: "Across all teams" }, { label: "Closed items", value: 17, trend: { value: 8 }, note: "Up 8% this week", sub: "Since Monday" }] }) })
 */
export function appShell(p) {
  const q = p || /** @type {any} */ ({});
  /** @type {any} */
  const sb = q.sidebar && typeof q.sidebar === "object" ? q.sidebar : { id: "sidebar", groups: [] };
  const id = sb.id != null && sb.id !== "" ? String(sb.id) : "sidebar";
  const variant = /** @type {"sidebar"|"floating"|"inset"} */ (VARIANTS.indexOf(String(q.variant)) >= 0 ? String(q.variant) : VARIANTS.indexOf(String(sb.variant)) >= 0 ? String(sb.variant) : "sidebar");
  const trail = Array.isArray(q.breadcrumb) && q.breadcrumb.length ? q.breadcrumb : null;
  const title = has(q.title) ? q.title : "";
  const lvl = q.headingLevel === 2 || q.headingLevel === 3 ? q.headingLevel : 1;
  const header = html`${sidebarTrigger({ controls: id, k: has(q.k) ? String(q.k) : undefined })}<span class="gk-appShell__divider">${separator({ orientation: "vertical" })}</span>${
    trail ? html`<h${lvl} class="sr-only">${title}</h${lvl}>${breadcrumb({ items: trail })}` : html`<h${lvl} class="gk-appShell__title">${title}</h${lvl}>`
  }${has(q.actions) ? html`<div class="gk-appShell__actions">${q.actions}</div>` : ""}`;
  const side = sidebar({ ...sb, id, variant });
  return sidebarLayout({
    variant,
    content: html`${side}${sidebarInset({ header, content: html`<div class="gk-appShell__body">${has(q.content) ? q.content : ""}</div>` })}`,
  });
}
