// Page-level blocks composed from shadcn/ui new-york v4 anatomy (MIT; see THIRD_PARTY_NOTICES.md):
// the settings page (heading, divider, side nav and a content column), its form sections and switch rows.
import { html, attrs, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { separator } from "../components/separator.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/** An id-safe slug of free text. @param {unknown} v @param {string} d */
const slug = (v, d) => String(v == null ? "" : v).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || d;

/**
 * @component settingsLayout
 * @title Settings Layout
 * @category Settings
 * @summary The settings page: a heading with a muted description, a divider, a side nav of ghost buttons and the content column.
 * @param {{title: string, description?: string, nav?: Array<{label: string, href?: string, act?: string, v?: string, active?: boolean}>, navLabel?: string, content?: unknown, k?: string}} p
 * `title` is an h2 (the page's h1 lives in the app shell) and `description` the muted line under it. `nav` items are links (safe `href`, built with linkAttrs, so a hash `href` carries target="_self" and stays in the frame) or buttons (`act`, `v`) in the ghost button style; the one with `active: true` is filled, bold and marked aria-current. The nav is a row that wraps on narrow containers and a 20% wide column from 48rem. `content` is SafeHtml, usually several `formSection` blocks, capped at 42rem. `navLabel` names the nav (default "Settings"). `k` prefixes the nav buttons' data-k (default "settings"). Needs button.css and separator.css; no island of its own.
 * @emits the act of each nav item (data-v)
 * @states default, no-nav, empty
 * @a11y A nav landmark named by `navLabel` holds the items; the current one carries aria-current ("page" for a link, "true" for a button) and is also bold and filled, so it is not colour alone. The heading and description sit above the divider, which is decorative.
 * @example default: settingsLayout({ k: "set-a", title: "Settings", description: "Manage your account settings and set e-mail preferences.", nav: [{ label: "Profile", href: "#profile", active: true }, { label: "Account", href: "#account" }, { label: "Appearance", href: "#appearance" }, { label: "Notifications", act: "settings:go", v: "notifications" }], content: [formSection({ k: "set-a-profile", title: "Profile", description: "This is how others will see you on the site.", content: [field({ label: "Display name", id: "set-a-name", description: "Shown on records you own. You can change it once every 30 days.", props: { name: "name", value: "Dana Reyes", k: "set-a-name" } }), field({ label: "Email", id: "set-a-email", description: "Verified by your Google account.", props: { type: "email", value: "dana@example.org", readonly: true, k: "set-a-email" } }), select({ id: "set-a-team", name: "team", label: "Team", value: "platform", options: [{ value: "platform", label: "Platform" }, { value: "security", label: "Security" }, { value: "finance", label: "Finance" }] }), field({ label: "Bio", id: "set-a-bio", kind: "textarea", description: "A line or two about your role.", props: { name: "bio", rows: 3, k: "set-a-bio" } }), button({ label: "Update profile", act: "settings:save", k: "set-a-save" })] }), formSection({ k: "set-a-notify", title: "Notifications", description: "Choose what lands in your inbox.", content: [switchRow({ title: "Review reminders", description: "An e-mail when a system you own is due for review.", control: switchView({ label: "Review reminders", hideLabel: true, checked: true, k: "set-a-remind", v: "remind" }) }), switchRow({ title: "Weekly digest", description: "A Monday summary of changes across the register.", control: switchView({ label: "Weekly digest", hideLabel: true, k: "set-a-digest", v: "digest" }) }), switchRow({ title: "Security alerts", description: "Always sent, so access changes are never missed.", control: "Always on" })] })] })
 * @example no-nav: settingsLayout({ k: "set-b", title: "Preferences", description: "Applies to this browser.", content: formSection({ k: "set-b-prefs", title: "Display", description: "Stored in this browser only.", content: [switchRow({ title: "Compact rows", description: "Fit more records on screen.", control: switchView({ label: "Compact rows", hideLabel: true, k: "set-b-compact", v: "compact" }) }), switchRow({ title: "Reduce motion", description: "Skip chart and panel animation.", control: switchView({ label: "Reduce motion", hideLabel: true, checked: true, k: "set-b-motion", v: "motion" }) })] }) })
 * @example empty: settingsLayout({ k: "set-c", title: "Settings" })
 */
export function settingsLayout(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "settings";
  const items = Array.isArray(q.nav) ? q.nav.filter((/** @type {any} */ n) => n && typeof n === "object") : [];
  return html`<div class="gk-settingsLayout"><div class="gk-settingsLayout__page"><div class="gk-settingsLayout__head"><h2 class="gk-settingsLayout__title">${q.title}</h2>${has(q.description) ? html`<p class="gk-settingsLayout__description">${q.description}</p>` : ""}</div>${separator({})}<div class="gk-settingsLayout__body">${
    items.length ? html`<nav class="gk-settingsLayout__nav" aria-label="${has(q.navLabel) ? q.navLabel : "Settings"}">${items.map((/** @type {any} */ n, /** @type {number} */ i) => {
      const common = { class: "gk-btn gk-settingsLayout__link", "data-variant": "ghost", "data-active": n.active === true ? "1" : null, "data-k": k + "-nav-" + slug(has(n.v) ? n.v : n.label, String(i)) };
      if (isSafeUrl(n.href)) return html`<a ${attrs({ ...common, ...linkAttrs(n.href), "aria-current": n.active === true ? "page" : null, "data-act": n.act || null, "data-v": has(n.v) ? n.v : null })}>${n.label}</a>`;
      return html`<button ${attrs({ ...common, type: "button", "aria-current": n.active === true ? "true" : null, "data-act": n.act || null, "data-v": has(n.v) ? n.v : null })}>${n.label}</button>`;
    })}</nav>` : ""
  }<div class="gk-settingsLayout__content">${has(q.content) ? q.content : ""}</div></div></div></div>`;
}

/**
 * @component formSection
 * @title Form Section
 * @category Settings
 * @summary One settings section: an h3, a muted description, a divider and the form fields below.
 * @param {{title: string, description?: string, content?: unknown, k?: string}} p
 * `content` is SafeHtml, usually `field` and `switchRow` views; they are stacked with a 32px gap. `k` is the section id used to name the region (default: the title with every character outside A-Z, a-z, 0-9, _ and - replaced by a dash; pass `k` whenever titles may collide).
 * @emits none
 * @states default, no-description
 * @a11y A section element named by its heading (aria-labelledby). The divider is decorative.
 * @example default: formSection({ k: "fs-a", title: "Notifications", description: "Choose how and when Acme Register contacts you.", content: [radioGroup({ label: "Notify me about", name: "fs-a-notify", value: "mentions", options: [{ value: "all", label: "All new activity" }, { value: "mentions", label: "Direct messages and mentions" }, { value: "none", label: "Nothing" }], k: "fs-a-notify" }), switchRow({ title: "Communication e-mails", description: "Receive e-mails about your account activity.", control: switchView({ label: "Communication e-mails", hideLabel: true, checked: true, k: "fs-a-comm", v: "comm" }) }), switchRow({ title: "Marketing e-mails", description: "Receive e-mails about new products and features.", control: switchView({ label: "Marketing e-mails", hideLabel: true, k: "fs-a-marketing", v: "marketing" }) }), switchRow({ title: "Security e-mails", description: "Receive e-mails about your account activity and security.", control: switchView({ label: "Security e-mails", hideLabel: true, checked: true, disabled: true, k: "fs-a-security", v: "security" }) }), checkbox({ label: "Use different settings for my mobile devices", description: "You can manage mobile notifications in the mobile settings page.", k: "fs-a-mobile" }), button({ label: "Save preferences", act: "fs:save", k: "fs-a-save" })] })
 * @example no-description: formSection({ title: "Danger zone", content: [alert({ title: "This cannot be undone", description: "Deleting the Acme workspace removes every record for all members.", variant: "destructive" }), button({ label: "Delete workspace", variant: "destructive", act: "workspace:delete", k: "fs-delete" })] })
 */
export function formSection(p) {
  const q = p || /** @type {any} */ ({});
  const id = "fs-" + (has(q.k) ? slug(q.k, "section") : slug(q.title, "section"));
  return html`<section class="gk-formSection" aria-labelledby="${id}"><div class="gk-formSection__head"><h3 class="gk-formSection__title" id="${id}">${q.title}</h3>${has(q.description) ? html`<p class="gk-formSection__description">${q.description}</p>` : ""}</div>${separator({})}<div class="gk-formSection__content">${has(q.content) ? q.content : ""}</div></section>`;
}

/**
 * @component switchRow
 * @title Switch Row
 * @category Settings
 * @summary A bordered row with a title and description on the left and a control, usually a switch, on the right.
 * @param {{title: string, description?: string, control?: unknown, k?: string}} p
 * `control` is SafeHtml, for example `switchView({ label: "Marketing e-mails", hideLabel: true })`; give the control its own accessible name, the row text is not wired to it. `k` makes the row's data-k.
 * @emits none
 * @states default, no-description
 * @a11y The title and description are plain text beside the control, so the row reads in order; the control keeps its own role, state and name.
 * @example default: card({ title: "E-mail notifications", description: "Manage the e-mails Acme Register sends you.", content: [switchRow({ title: "Communication e-mails", description: "Receive e-mails about your account activity.", control: switchView({ label: "Communication e-mails", hideLabel: true, checked: true, k: "sr-comm", v: "comm" }) }), switchRow({ title: "Marketing e-mails", description: "Receive e-mails about new products and features.", control: switchView({ label: "Marketing e-mails", hideLabel: true, k: "sr-marketing", v: "marketing" }) }), switchRow({ title: "Social e-mails", description: "Receive e-mails for friend requests, follows and more.", control: switchView({ label: "Social e-mails", hideLabel: true, checked: true, k: "sr-social", v: "social" }) }), switchRow({ title: "Security e-mails", description: "Receive e-mails about your account activity and security.", control: switchView({ label: "Security e-mails", hideLabel: true, checked: true, disabled: true, tip: "Always on", k: "sr-security", v: "security" }) })] })
 * @example no-description: switchRow({ title: "Security alerts", control: "Always on" })
 */
export function switchRow(p) {
  const q = p || /** @type {any} */ ({});
  return html`<div class="gk-switchRow"${has(q.k) ? html` data-k="${q.k}"` : ""}><div class="gk-switchRow__text"><div class="gk-switchRow__title">${q.title}</div>${has(q.description) ? html`<p class="gk-switchRow__description">${q.description}</p>` : ""}</div>${has(q.control) ? html`<div class="gk-switchRow__control">${q.control}</div>` : ""}</div>`;
}
