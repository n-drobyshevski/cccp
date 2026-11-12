// The inventory table (lx3 list). Pure views: header cells with aria-sort, body cells per column
// key, the Show-more footer and the empty state. The page decides which rows and columns; this
// file only draws them. A name is a real button, so the row opens from the keyboard.
import { html, raw } from "../lib/html.js";
import { nextSort } from "../../vendor/gas_shared/ui/tableModel";
import { lifecycleLabel } from "../../domain/facets";
import { dots, dotsHead } from "./dots.js";
import { num } from "../lib/format.js";

export const PAGE_STEP = 50;

const SORT_ICONS = {
  none: '<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 1 8 4.5H2zM5 9 2 5.5h6z"/></svg>',
  asc: '<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 1.5 9 7H1z"/></svg>',
  desc: '<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 8.5 1 3h8z"/></svg>',
};

/** The lifecycle values the mockup colours, by normalised key. */
const LIFECYCLE_CLASS = {
  GENERAL_AVAILABILITY: "ga", PRODUCTION: "ga",
  ALPHA: "beta", BETA: "beta", EARLY_ACCESS: "beta",
  END_OF_LIFE: "eol", END_OF_SUPPORT: "eol",
  END_OF_GROWTH: "dec", DECOMMISSIONING: "dec",
};

export const lifecycleClass = (v) => LIFECYCLE_CLASS[String(v == null ? "" : v).trim().toUpperCase().replace(/[\s-]+/g, "_")] || "";

/** Completeness colour step: under 50 gap, under 80 attention, else fine. */
export const pctStep = (p) => (p < 50 ? "bad" : p < 80 ? "warn" : "ok");

/** The sort that a click on `key` asks for, given the current one. */
export function sortAfter(sort, desc, col) {
  const n = nextSort({ key: sort, descending: !!desc }, col.key, !!col.descFirst);
  return { sort: n.key, desc: n.descending };
}

const blank = (v) => v == null || String(v).trim() === "";
const dash = () => html`<span class="mut" aria-hidden="true">—</span><span class="sr-only">Not set</span>`;
const plain = (v) => (blank(v) ? dash() : v);

/** The body cell of one column for one row. */
export function cell(col, r) {
  const a = r.app;
  switch (col.key) {
    case "n":
      return html`<button type="button" class="nm" data-k="open-${a.id}" data-tip="${a.name}">${a.name}</button>`;
    case "d": return plain(a.domain);
    case "sd": return plain(a.subdomain);
    case "g": return blank(a.supportGroup) ? dash() : html`<span class="mut">${a.supportGroup}</span>`;
    case "t":
      return a.tier ? html`<span class="tier t${a.tier}">T${a.tier}</span>` : html`<span class="tier t0" data-tip="No tiering set">–<span class="sr-only">No tiering set</span></span>`;
    case "lc":
      return blank(a.lifecycle) ? dash() : html`<span class="lc ${lifecycleClass(a.lifecycle)}">${lifecycleLabel(a.lifecycle)}</span>`;
    case "o": return plain(a.owner);
    case "so": return blank(a.securityOfficer) ? html`<span class="mut">None assigned</span>` : a.securityOfficer;
    case "ty": return plain(a.typology);
    case "h": return plain(a.hosting);
    case "q":
      return html`<span class="qcell"><span class="qbar" aria-hidden="true"><i class="${pctStep(r.pct)}" style="width:${Math.max(0, Math.min(100, r.pct))}%"></i></span><small>${r.pct}%</small></span>`;
    case "st": return dots(r.status);
    default: return "";
  }
}

/** One header cell: a button inside a th that carries aria-sort while it is the active sort. */
export function headCell(col, sort, desc) {
  const on = col.key === sort;
  const dir = on ? (desc ? "descending" : "ascending") : "";
  const icon = on ? (desc ? SORT_ICONS.desc : SORT_ICONS.asc) : SORT_ICONS.none;
  const label = col.key === "st" ? html`${dotsHead()}<span class="sr-only">Status</span>` : col.label;
  return html`<th scope="col"${dir ? html` aria-sort="${dir}"` : ""}><button type="button" class="sh${on ? " on" : ""}" data-act="sort" data-col="${col.key}" data-k="sort-${col.key}">${label}${raw(icon)}</button></th>`;
}

/** The table: `cols` are Column defs, `rows` the rows to draw (already cut to the limit). */
export function tableView(m) {
  return html`<div class="tw" data-keep-scroll="table"><table data-table="list"><thead><tr>${m.cols.map((c) => headCell(c, m.sort, m.desc))}</tr></thead><tbody>${m.rows.map((r) => html`<tr data-id="${r.app.id}">${m.cols.map((c) => html`<td data-col="${c.key}">${cell(c, r)}</td>`)}</tr>`)}</tbody></table></div>`;
}

/** The footer: 'Show 50 more · N left', or nothing when everything is drawn. */
export function moreView(shown, total) {
  const left = total - shown;
  if (left <= 0) return html``;
  const step = Math.min(PAGE_STEP, left);
  return html`<div class="more"><button type="button" class="btn" data-act="more" data-k="more">Show ${step} more · ${num(left)} left</button></div>`;
}

/** Nothing matches: offers Clear all. With an empty register there is nothing to clear. */
export function emptyView(registerSize) {
  if (!registerSize) {
    return html`<div class="empty"><b>No applications to show</b><span>The register has no visible applications.</span></div>`;
  }
  return html`<div class="empty"><b>No application matches</b><span>Try removing a filter or changing the search.</span><button type="button" class="btn" data-act="clear-all" data-k="empty-clear">Clear all filters</button></div>`;
}
