// Anatomy and styling adapted from shadcn/ui new-york v4 Item (MIT; see THIRD_PARTY_NOTICES.md).
import { html, attrs, isSafe, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { avatar } from "./avatar.js";
import { button } from "./button.js";

const VARIANTS = ["default", "outline", "muted"];

/** @param {unknown} v */
const has = (v) => v != null && v !== "";

/**
 * The media slot: an icon name, an avatar, or ready SafeHtml.
 * @param {unknown} m
 */
function mediaPart(m) {
  if (m == null || m === false) return "";
  if (isSafe(m)) return html`<div class="gk-item__media">${m}</div>`;
  const o = /** @type {any} */ (m);
  if (typeof o === "object" && typeof o.icon === "string") {
    return html`<div class="gk-item__media is-icon">${icon(o.icon, 16)}</div>`;
  }
  if (typeof o === "object" && o.avatar && typeof o.avatar === "object") {
    return html`<div class="gk-item__media">${avatar({ size: "default", ...o.avatar })}</div>`;
  }
  return "";
}

/**
 * The actions slot: SafeHtml, or button descriptors drawn with the kit button.
 * @param {unknown} a
 */
function actionsPart(a) {
  if (a == null || a === false) return "";
  if (isSafe(a)) return html`<div class="gk-item__actions">${a}</div>`;
  if (!Array.isArray(a) || !a.length) return "";
  const btns = a.map((d) => (isSafe(d) ? d : d && typeof d === "object" ? button({ label: d.label, act: d.act, k: d.k, tip: d.tip, variant: d.variant || "outline", size: "sm" }) : ""));
  return html`<div class="gk-item__actions">${btns}</div>`;
}

/**
 * @component item
 * @title Item
 * @category Data display
 * @summary A generic list row with media, a title, a description and actions.
 * @param {{title: string, description?: string, media?: {icon: string}|{avatar: {name: string, src?: string}}|unknown, actions?: unknown, href?: string, variant?: "default"|"outline"|"muted", size?: "default"|"sm", k?: string}} p
 * `title` is plain text. `media` is `{ icon }` (a name from the kit icon set), `{ avatar: { name, src? } }` (the kit avatar) or ready SafeHtml. `actions` is ready SafeHtml (buttons, a menu) or an array of button descriptors `{ label, act, k, variant?, tip? }` drawn with the kit button (outline, small unless `variant` says otherwise). With a safe `href` (http, https, mailto or relative) the title is the link, built with linkAttrs (a hash `href` carries target="_self" and stays in the frame; an absolute or mailto one opens in the top window with rel="noopener noreferrer"); an unsafe one drops to plain text. The row itself is never a link, so actions stay valid inside it. `variant` and `size` fall back to the default. `k` goes to `data-k` on the row.
 * @emits none (the actions emit their own acts)
 * @states default, with-icon, with-avatar, with-actions, link, outline, muted, small
 * @a11y The row is a plain block; inside an itemGroup it is a list item. The title link is the only link, so the row has one tab stop for navigation plus its action buttons. Media is decorative or named by its own component (the avatar names the person). The focus ring is the kit style from base.css.
 * @example default: item({ title: "Quarterly report", description: "Updated 3 days ago" })
 * @example with-icon: item({ title: "Security settings", description: "Passwords and sign-in", media: { icon: "lock" } })
 * @example with-avatar: item({ title: "Acme Admin", description: "admin@example.org", media: { avatar: { name: "Acme Admin" } } })
 * @example with-actions: item({ title: "Acme Support", description: "Invited this week", media: { avatar: { name: "Acme Support" } }, actions: [{ label: "Accept", act: "invite:accept", k: "it-accept" }, { label: "Decline", act: "invite:decline", k: "it-decline", variant: "ghost" }] })
 * @example link: item({ title: "Release notes", description: "What changed in the last version", href: "/docs/releases", media: { icon: "info" }, k: "it-link" })
 * @example outline: item({ title: "Backups", description: "Daily at 02:00 UTC", variant: "outline", media: { icon: "download" } })
 * @example muted: item({ title: "Archived project", description: "Read only since June", variant: "muted", media: { icon: "table" } })
 * @example small: item({ title: "Acme Corp", description: "12 members", size: "sm", media: { icon: "users" } })
 */
export function item(p) {
  const q = p || { title: "" };
  const variant = VARIANTS.indexOf(String(q.variant)) >= 0 ? String(q.variant) : "default";
  const size = q.size === "sm" ? "sm" : "default";
  const title = q.href != null && isSafeUrl(q.href) && has(q.href)
    ? html`<a ${attrs({ class: "gk-item__link", ...linkAttrs(q.href) })}>${q.title}</a>`
    : q.title;
  return html`<div ${attrs({ class: "gk-item is-" + variant + " is-" + size, "data-k": has(q.k) ? q.k : null })}>${mediaPart(q.media)}<div class="gk-item__content"><div class="gk-item__title">${title}</div>${has(q.description) ? html`<p class="gk-item__description">${q.description}</p>` : ""}</div>${actionsPart(q.actions)}</div>`;
}

/**
 * @component itemGroup
 * @title Item Group
 * @category Data display
 * @summary A list of items with list semantics, an optional label and optional separators.
 * @param {{label?: string, items: Array<object|unknown>, separated?: boolean, hideLabel?: boolean, k?: string}} p
 * `items` are item props or ready SafeHtml (an item with its own wrapper). `label` names the list; it is visible unless `hideLabel` is true, then it is screen-reader text. `separated` draws a rule between rows. `k` goes to `data-k` on the list.
 * @emits none
 * @states default, separated
 * @a11y A real ul with li rows, named by the label (aria-labelledby on a visible label, aria-label when hidden). A group with no label is an unnamed list.
 * @example default: itemGroup({ label: "Team", items: [{ title: "Acme Owner", description: "owner@example.org", media: { avatar: { name: "Acme Owner" } } }, { title: "Acme Editor", description: "editor@example.org", media: { avatar: { name: "Acme Editor" } } }] })
 * @example separated: itemGroup({ label: "Shortcuts", separated: true, items: [{ title: "Settings", media: { icon: "gear" } }, { title: "Downloads", media: { icon: "download" } }, { title: "Trash", media: { icon: "trash" } }] })
 */
export function itemGroup(p) {
  const q = p || { items: [] };
  const items = Array.isArray(q.items) ? q.items : [];
  const hasLabel = has(q.label);
  const lid = hasLabel && !q.hideLabel ? "gk-item-group-" + String(q.k != null && q.k !== "" ? q.k : q.label).replace(/[^A-Za-z0-9_-]+/g, "-") : null;
  const rows = items.map((it) => html`<li class="gk-item-group__row">${isSafe(it) ? it : item(/** @type {any} */ (it))}</li>`);
  return html`<div class="gk-item-group-wrap">${hasLabel ? html`<div ${attrs({ class: q.hideLabel ? "sr-only" : "gk-item-group__label", id: lid })}>${q.label}</div>` : ""}<ul ${attrs({ class: "gk-item-group" + (q.separated ? " is-separated" : ""), "aria-labelledby": lid, "aria-label": hasLabel && q.hideLabel ? q.label : null, "data-k": has(q.k) ? q.k : null })}>${rows}</ul></div>`;
}
