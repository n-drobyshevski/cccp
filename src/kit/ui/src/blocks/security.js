// Page-level block for an internal register app: the security posture page. Composed from kit parts
// (sectionCards, card, stackBar, barChart, dataTable, statusDot, itemGroup); it adds layout only.
import { html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { badge } from "../components/badge.js";
import { barChart } from "../components/barChart.js";
import { card } from "../components/card.js";
import { dataTable } from "../components/dataTable.js";
import { emptyState } from "../components/emptyState.js";
import { itemGroup } from "../components/item.js";
import { stackBar } from "../components/stackBar.js";
import { statusDot } from "../components/statusDot.js";
import { sectionCards } from "./dashboard.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/** Severity levels, worst first: the word shown, and the status shape and colour family each one uses. */
const LEVELS = [
  { level: "critical", word: "Critical", status: "bad" },
  { level: "high", word: "High", status: "warn" },
  { level: "medium", word: "Medium", status: "info" },
  { level: "low", word: "Low", status: "none" },
];

/** @param {unknown} v */
const levelOf = (v) => LEVELS.find((l) => l.level === String(v).toLowerCase()) || null;

const EVENT_ICONS = { access: "users", settings: "gear", export: "download" };

/**
 * @component securityOverview
 * @title Security Overview
 * @category Dashboard
 * @summary A security posture page body for an internal register: KPI cards, a severity breakdown, findings by system, a findings table with severity words and recent audit events.
 * @param {{cards?: Array<{label: string, value: number|string, trend?: {value: number}, note?: string, sub?: string}>, severity?: Array<{level: "critical"|"high"|"medium"|"low", count: number}>, bySystem?: Array<{system: string, count: number}>, findings?: Array<{id: string, title: string, system?: string, severity: "critical"|"high"|"medium"|"low", due?: string, pastSla?: boolean, owner?: string}>, events?: Array<{who: string, what: string, detail?: string, when?: string, kind?: "access"|"settings"|"export"}>, emptyText?: string, k?: string}} p
 * Each part is optional and drawn only when given; with none of them the block shows a "No security data yet" empty state (`emptyText` replaces its text). `cards` go to `sectionCards` (open findings, critical, past SLA, mean time to fix). `severity` is the count per level; it feeds a `stackBar` and a visible list of level, dot and count, and when every count is zero the card says "All clear". `bySystem` is a horizontal `barChart` of open findings per system. `findings` is the table: the severity cell is a status dot plus the level word, and a `pastSla` row adds a "Past SLA" badge next to the due date (a `yyyy-MM-dd` string already formatted by the server). An empty `findings` list shows the table's empty state. `events` is the audit trail (who changed access, saved settings, exported), drawn as an `itemGroup` with an icon per `kind`. `k` prefixes the keys of the parts (default "sec"). Put it in the `content` of `appShell`. Needs card.css, badge.css, stackBar.css, statusDot.css, barChart.css, dataTable.css, item.css and dashboard.css; the manifest lists the kit ones as cssDeps.
 * @emits the dataTable acts (dataTable:sort, dataTable:more, dataTable:clear, dataTable:retry)
 * @states default, all-clear, empty
 * @a11y The parts keep their own semantics: headed cards (h3), a stack bar with a text summary, a chart with a screen-reader table, a captioned table and a named list of events. Severity is always a word beside a shaped dot, and past SLA is a word, never colour alone. The grid is plain containers with no role. Layout answers to the block's own width.
 * @example default: securityOverview({ k: "sec-a", cards: [{ label: "Open findings", value: 128, trend: { value: -6.2 }, note: "Down 6.2% this month", sub: "Across 41 Acme systems" }, { label: "Critical", value: 7, trend: { value: 16.7 }, note: "Up 16.7% this month", sub: "Needs action this week" }, { label: "Past SLA", value: 19, trend: { value: -9.5 }, note: "Down 9.5% this month", sub: "Older than the agreed window" }, { label: "Mean time to fix", value: "12.4 days", trend: { value: -4 }, note: "Faster than last quarter", sub: "Critical and high findings" }], severity: [{ level: "critical", count: 7 }, { level: "high", count: 31 }, { level: "medium", count: 58 }, { level: "low", count: 32 }], bySystem: [{ system: "Acme Billing", count: 24 }, { system: "Acme Payroll", count: 19 }, { system: "Acme Mail Relay", count: 14 }, { system: "Acme Portal", count: 11 }, { system: "Acme Wiki", count: 6 }], findings: [{ id: "FND-1042", title: "Outdated TLS configuration", system: "Acme Billing", severity: "critical", due: "2026-11-02", pastSla: true, owner: "Dana Reyes" }, { id: "FND-1038", title: "Admin console exposed to the internet", system: "Acme Payroll", severity: "critical", due: "2026-11-20", owner: "Sam Okafor" }, { id: "FND-1029", title: "Service account without an owner", system: "Acme Mail Relay", severity: "high", due: "2026-11-28", owner: "Alex Lee" }, { id: "FND-1017", title: "Backups not verified for 30 days", system: "Acme Portal", severity: "medium", due: "2026-12-15", owner: "Dana Reyes" }, { id: "FND-0996", title: "Missing security headers", system: "Acme Wiki", severity: "low", due: "2027-01-10", owner: "Sam Okafor" }], events: [{ who: "Dana Reyes", what: "changed access", detail: "Added alex@example.org as viewer", when: "2026-11-14 09:12 UTC", kind: "access" }, { who: "Sam Okafor", what: "saved settings", detail: "Review window set to 30 days", when: "2026-11-13 16:40 UTC", kind: "settings" }, { who: "Alex Lee", what: "exported the register", detail: "1,240 rows as CSV", when: "2026-11-13 11:05 UTC", kind: "export" }, { who: "Dana Reyes", what: "changed access", detail: "Removed sam@example.net", when: "2026-11-10 08:30 UTC", kind: "access" }] })
 * @example all-clear: securityOverview({ k: "sec-b", cards: [{ label: "Open findings", value: 0, note: "Nothing open", sub: "Across 41 Acme systems" }, { label: "Critical", value: 0 }, { label: "Past SLA", value: 0 }, { label: "Mean time to fix", value: "9.1 days", sub: "Last 90 days" }], severity: [{ level: "critical", count: 0 }, { level: "high", count: 0 }, { level: "medium", count: 0 }, { level: "low", count: 0 }], findings: [], events: [{ who: "Sam Okafor", what: "exported the register", detail: "1,240 rows as CSV", when: "2026-11-13 11:05 UTC", kind: "export" }] })
 * @example empty: securityOverview({ k: "sec-c" })
 */
export function securityOverview(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "sec";
  const cards = Array.isArray(q.cards) && q.cards.length ? q.cards : null;
  const sev = Array.isArray(q.severity) ? q.severity : null;
  const by = Array.isArray(q.bySystem) && q.bySystem.length ? q.bySystem : null;
  const finds = Array.isArray(q.findings) ? q.findings : null;
  const events = Array.isArray(q.events) ? q.events : null;
  if (!cards && !sev && !by && !finds && !events) {
    return html`<div class="gk-securityOverview">${emptyState({ media: { icon: "lock" }, title: has(q.emptyText) ? String(q.emptyText) : "No security data yet", body: "Findings and audit events appear here after the first scan." })}</div>`;
  }

  /** @type {unknown} */
  let severity = "";
  if (sev) {
    const rows = LEVELS.map((l) => {
      const hit = sev.find((s) => s && levelOf(s.level) === l);
      const n = hit ? Math.max(0, Math.round(Number(hit.count)) || 0) : 0;
      return { ...l, n };
    });
    const total = rows.reduce((a, r) => a + r.n, 0);
    severity = card({
      k: k + "-severity", title: "Severity breakdown", description: total ? fmtCount(total) + " open findings by level" : "No open findings",
      content: html`<div class="gk-securityOverview__sev">${stackBar({ label: "Open findings by severity", emptyText: "All clear", segments: rows.map((r) => ({ status: /** @type {any} */ (r.status), count: r.n, label: r.word })) })}${total ? html`<ul class="gk-securityOverview__legend" aria-label="Open findings per level">${rows.map((r) => html`<li class="gk-securityOverview__legendRow">${statusDot({ status: /** @type {any} */ (r.status), word: r.word })}<span class="gk-securityOverview__count">${fmtCount(r.n)}</span></li>`)}</ul>` : html`<p class="gk-securityOverview__clear">${statusDot({ status: "ok", word: "All clear" })}<span class="gk-securityOverview__muted">No findings are open.</span></p>`}</div>`,
    });
  }
  const bySystem = by
    ? card({ k: k + "-systems", title: "Open findings by system", description: "The five systems with the most open findings", content: barChart({ title: "Open findings by system", orientation: "horizontal", k: k + "-systems-chart", data: by.map((/** @type {any} */ s) => ({ s: s && s.system, n: s && Number(s.count) })), xKey: "s", series: [{ key: "n", label: "Open findings" }], valueFormat: "number" }) })
    : "";

  const table = finds
    ? card({
      k: k + "-findings", title: "Findings", description: "Open findings, worst first",
      content: dataTable({
        caption: "Open findings", k: k + "-table", rows: finds.filter((/** @type {any} */ f) => f && typeof f === "object"),
        emptyTitle: "No open findings", emptyHint: "Everything reported so far has been fixed.",
        columns: [
          { key: "id", label: "Finding" },
          { key: "title", label: "Title", kind: "ell" },
          { key: "system", label: "System" },
          { label: "Severity", kind: "status", render: (/** @type {any} */ r) => { const l = levelOf(r.severity); return statusDot({ status: /** @type {any} */ (l ? l.status : "none"), word: l ? l.word : "Not rated" }); } },
          { label: "Due", render: (/** @type {any} */ r) => (r.pastSla === true ? html`<span class="gk-securityOverview__due">${has(r.due) ? r.due : ""}${badge({ text: "Past SLA", variant: "bad" })}</span>` : has(r.due) ? r.due : null) },
          { key: "owner", label: "Owner" },
        ],
      }),
    })
    : "";

  const trail = events
    ? card({
      k: k + "-events", title: "Recent audit events", description: "Access changes, settings saves and exports",
      content: events.length
        ? itemGroup({ label: "Audit events", hideLabel: true, separated: true, k: k + "-events-list", items: events.filter((/** @type {any} */ e) => e && typeof e === "object").map((/** @type {any} */ e) => ({
          title: html`${e.who} ${e.what}`, description: [e.detail, e.when].filter(has).join(" - "), size: "sm",
          media: { icon: /** @type {any} */ (EVENT_ICONS)[String(e.kind)] || "list" },
        })) })
        : html`<p class="gk-securityOverview__muted">No audit events yet.</p>`,
    })
    : "";

  return html`<div class="gk-securityOverview">${cards ? sectionCards({ cards, k: k + "-cards" }) : ""}${severity || bySystem ? html`<div class="gk-securityOverview__row">${severity}${bySystem}</div>` : ""}${table}${trail}</div>`;
}
