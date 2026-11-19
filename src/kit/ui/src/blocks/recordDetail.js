// Page-level block: one record's detail page. Composed from kit parts (badge, button, tabs, card);
// it adds the description list and the activity timeline.
import { html, attrs, isSafeUrl } from "@gas-kit/client/html.js";
import { badge } from "../components/badge.js";
import { button } from "../components/button.js";
import { card } from "../components/card.js";
import { dataTable } from "../components/dataTable.js";
import { itemGroup } from "../components/item.js";
import { tabs } from "../components/tabs.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/**
 * @component recordDetail
 * @title Record Detail
 * @category Dashboard
 * @summary A record page: a header with the title, a status badge and actions, optional tabs, a description list of fields and an activity timeline.
 * @param {{title: string, subtitle?: string, status?: {text: string, variant?: "default"|"secondary"|"outline"|"destructive"|"ok"|"warn"|"bad"|"info"}, actions?: Array<{label: string, act?: string, href?: string, v?: string, variant?: "default"|"secondary"|"outline"|"ghost"|"destructive", k?: string}>, tabs?: {label: string, tabs: Array<{value: string, text?: string}>, value?: string, act?: string, k?: string}, fields?: Array<{label: string, value?: unknown, wide?: boolean}>, timeline?: Array<{title: string, description?: string, when?: string, who?: string}>, content?: unknown, panels?: Record<string, unknown>, headingLevel?: 1|2|3, k?: string}} p
 * `title` is the record's name (an h2 by default, since the app shell owns the h1; `headingLevel` 1 to 3 changes it). `status` is a `badge` whose text is always shown, so the state is a word. `actions` are buttons (`act`, `v`) or links (a safe `href`); the first is the primary one unless it sets a `variant`. `tabs` takes the props of the `tabs` view without `content`; the app re-renders on the act (default "tabs:select"). `fields` is the description list: label and value pairs in a two-column grid from 40rem wide (`wide: true` spans both); a blank value shows "Not set". `timeline` is the activity feed, newest first: a marker, the title, an optional description and `who` with `when` (text from the server, for example "2026-11-14 09:12 UTC"). `content` replaces the fields and timeline body, for a tab other than the first. `panels` maps a tab value to the SafeHtml of that tab and makes the tabs switch on their own (the uncontrolled mode of `tabs`); a tab with no entry shows the fields and timeline body. `k` prefixes the keys (default "record"). Mount tabsIsland when `tabs` is set. Needs button.css, badge.css, card.css and tabs.css.
 * @emits the act of each action (data-v), tabs:select (data-v; or the tabs' act)
 * @states default, no-tabs, empty-timeline
 * @a11y The title is a heading and the fields are a real dl with dt and dd pairs. The timeline is an ordered list whose markers are decorative, with the title as the first text of each entry. The status is a word in a badge, never colour alone. The tabs are a labelled tablist with arrow-key roving.
 * @example default: recordDetail({ k: "rec-a", title: "Acme Billing", subtitle: "SYS-0412", status: { text: "Review due", variant: "warn" }, actions: [{ label: "Edit", act: "record:edit", k: "rec-a-edit" }, { label: "Export", act: "record:export", variant: "outline", k: "rec-a-export" }], tabs: { label: "Record sections", value: "details", tabs: [{ value: "details", text: "Details" }, { value: "findings", text: "Findings" }, { value: "access", text: "Access" }] }, panels: { findings: dataTable({ caption: "Findings for Acme Billing", columns: [{ key: "id", label: "Finding" }, { key: "severity", label: "Severity" }, { key: "state", label: "State" }], rows: [{ id: "FND-1042", severity: "High", state: "Open" }, { id: "FND-0988", severity: "Medium", state: "In progress" }, { id: "FND-0911", severity: "Low", state: "Closed" }] }), access: itemGroup({ label: "People with access", separated: true, items: [{ title: "Dana Reyes", description: "Owner", media: { avatar: { name: "Dana Reyes" } } }, { title: "Sam Okafor", description: "Reviewer", media: { avatar: { name: "Sam Okafor" } } }, { title: "Alex Lee", description: "Viewer", media: { avatar: { name: "Alex Lee" } } }] }) }, fields: [{ label: "Owner", value: "Dana Reyes" }, { label: "Business unit", value: "Finance" }, { label: "Environment", value: "Production" }, { label: "Hosting", value: "Acme Cloud, eu-west" }, { label: "Last review", value: "2026-08-14" }, { label: "Next review", value: "2026-11-14" }, { label: "Description", value: "Invoices customers and reconciles payments with the bank feed.", wide: true }], timeline: [{ title: "Review requested", description: "Quarterly review opened.", who: "Sam Okafor", when: "2026-11-14 09:12 UTC" }, { title: "Owner changed", description: "From Alex Lee to Dana Reyes.", who: "Sam Okafor", when: "2026-10-02 15:48 UTC" }, { title: "Finding FND-1042 raised", description: "Outdated TLS configuration.", who: "Scanner", when: "2026-09-21 03:00 UTC" }, { title: "Record created", who: "Alex Lee", when: "2026-02-03 10:20 UTC" }] })
 * @example no-tabs: recordDetail({ k: "rec-b", title: "Acme Mail Relay", status: { text: "Active", variant: "ok" }, actions: [{ label: "Open in register", href: "#register", variant: "outline", k: "rec-b-open" }], fields: [{ label: "Owner", value: "Sam Okafor" }, { label: "Business unit", value: "IT" }, { label: "Notes", value: null }], timeline: [{ title: "Record created", who: "Alex Lee", when: "2026-02-03 10:20 UTC" }] })
 * @example empty-timeline: recordDetail({ k: "rec-c", title: "Acme Wiki", fields: [{ label: "Owner", value: "Alex Lee" }], timeline: [] })
 */
export function recordDetail(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "record";
  const lvl = q.headingLevel === 1 || q.headingLevel === 3 ? q.headingLevel : 2;
  const acts = (Array.isArray(q.actions) ? q.actions : []).filter((/** @type {any} */ a) => a && typeof a === "object");
  const fields = (Array.isArray(q.fields) ? q.fields : []).filter((/** @type {any} */ f) => f && typeof f === "object");
  const timeline = Array.isArray(q.timeline) ? q.timeline.filter((/** @type {any} */ t) => t && typeof t === "object") : [];
  const t = q.tabs && typeof q.tabs === "object" ? q.tabs : null;
  const status = q.status && typeof q.status === "object" && has(q.status.text) ? badge({ text: q.status.text, variant: q.status.variant }) : "";

  const buttons = acts.map((/** @type {any} */ a, /** @type {number} */ i) => button({
    label: a.label, variant: a.variant || (i === 0 ? "default" : "outline"), size: "sm", k: has(a.k) ? a.k : k + "-action-" + i,
    ...(a.href != null ? (isSafeUrl(a.href) ? { href: String(a.href) } : { disabled: true }) : { act: a.act, v: a.v }),
  }));

  const list = fields.length
    ? card({ k: k + "-fields", title: "Details", level: 3, content: html`<dl class="gk-recordDetail__fields">${fields.map((/** @type {any} */ f) => html`<div ${attrs({ class: "gk-recordDetail__field" + (f.wide === true ? " is-wide" : "") })}><dt class="gk-recordDetail__term">${f.label}</dt><dd class="gk-recordDetail__value">${has(f.value) ? f.value : html`<span class="gk-recordDetail__unset">Not set</span>`}</dd></div>`)}</dl>` })
    : "";
  const feed = Array.isArray(q.timeline)
    ? card({
      k: k + "-activity", title: "Activity", level: 3,
      content: timeline.length
        ? html`<ol class="gk-recordDetail__timeline">${timeline.map((/** @type {any} */ e) => html`<li class="gk-recordDetail__event"><span class="gk-recordDetail__marker" aria-hidden="true"></span><div class="gk-recordDetail__eventBody"><div class="gk-recordDetail__eventTitle">${e.title}</div>${has(e.description) ? html`<p class="gk-recordDetail__eventText">${e.description}</p>` : ""}${has(e.who) || has(e.when) ? html`<p class="gk-recordDetail__eventMeta">${[e.who, e.when].filter(has).join(" - ")}</p>` : ""}</div></li>`)}</ol>`
        : html`<p class="gk-recordDetail__unset">No activity yet.</p>`,
    })
    : "";
  const body = has(q.content) ? q.content : html`<div class="gk-recordDetail__grid">${list}${feed}</div>`;

  return html`<div class="gk-recordDetail"><div class="gk-recordDetail__head"><div class="gk-recordDetail__heading"><div class="gk-recordDetail__titleRow"><h${lvl} class="gk-recordDetail__title">${q.title}</h${lvl}>${status}</div>${has(q.subtitle) ? html`<p class="gk-recordDetail__subtitle">${q.subtitle}</p>` : ""}</div>${buttons.length ? html`<div class="gk-recordDetail__actions">${buttons}</div>` : ""}</div>${t ? tabs({ ...t, k: has(t.k) ? t.k : k + "-tabs", variant: "line", content: body, ...(q.panels && typeof q.panels === "object" ? { panels: Object.fromEntries((Array.isArray(t.tabs) ? t.tabs : []).map((/** @type {any} */ x) => [x.value, /** @type {any} */ (q.panels)[x.value] != null ? /** @type {any} */ (q.panels)[x.value] : body])) } : {}) }) : body}</div>`;
}
