// The Heatmap lens of the Inventory (proto.src.html heatmap, identity G): the filtered register grouped
// by domain, largest first. A group row carries a stacked status bar per pillar (OK, Attention, Gap,
// No data, the last hatched); opened, it lists its applications with the status glyph and the short
// reason in every pillar. Pillar column heads are in the pillar's colour over a 3px underline. Which
// groups are open is remembered across filter changes (the first sight of the lens seeds it with the
// largest group); while the result has 40 applications or fewer, or one group, every group shows
// open and a toggle closes it in a separate set that a filter change clears. The Inventory page owns
// the count line, the pillar tabs and the clicks; this file draws the content and holds the open
// groups.
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { num } from "../lib/format.js";
import { glyphMark } from "../components/glyph.js";
import { emptyView } from "../components/table.js";
import { HEATMAP_LEAD_HEADS } from "../../domain/heatmap";
import { PILLARS } from "../../domain/types";
import { PILLAR_LABEL, STATUS_WORD } from "../../domain/facets";
import { HEAT_STACK, heatmapModel, isOpenAll } from "../../domain/heatmap";

let open = null;
let closedSmall = new Set();

const isSmall = isOpenAll;

const tierMark = (a) => a.tier
  ? html`<span class="tier t${a.tier}">T${a.tier}</span>`
  : html`<span class="tier t0" data-tip="No tiering set">–<span class="sr-only">No tiering set</span></span>`;

/** The words for one bar: '3 gaps · 2 need attention · 1 no data · 10 OK'. */
export function barText(c) {
  return num(c.bad) + (c.bad === 1 ? " gap" : " gaps") + " · " + num(c.warn) + (c.warn === 1 ? " needs attention" : " need attention") + " · " + num(c.none) + " no data · " + num(c.ok) + " OK";
}

function barCell(g, p) {
  const c = g.counts[p];
  const text = PILLAR_LABEL[p] + ": " + barText(c);
  const segs = HEAT_STACK.filter((s) => c[s] > 0);
  return html`<td class="sbc"><span class="sbw" tabindex="0" data-tip="${text}"><span class="sb" role="img" aria-label="${text}">${segs.map((s) => html`<i class="${s}" style="flex:${c[s]}"></i>`)}</span><small data-bad="${p}" class="${c.bad ? "bad" : ""}">${c.bad || ""}</small></span></td>`;
}

function appRow(r) {
  const a = r.app;
  return html`<tr data-id="${a.id}" data-dom="${a.domain}"><td><button type="button" class="nm" data-k="open-${a.id}" data-tip="${a.name}">${a.name}</button></td><td>${tierMark(a)}</td>${PILLARS.map((p) => {
    const s = r.status[p];
    return html`<td class="hc ${s.status}" data-pillar="${p}"><span>${glyphMark(s.status)}<span class="hw"><span class="sr-only">${PILLAR_LABEL[p] + ": " + STATUS_WORD[s.status] + ". "}</span>${s.sentence}</span></span></td>`;
  })}</tr>`;
}

function groupRows(g, isOpen) {
  return html`<tr class="grp" data-group="${g.name}"><td colspan="2"><button type="button" class="gb" data-act="grp" data-grp="${g.name}" data-k="grp-${g.name}" aria-expanded="${isOpen ? "true" : "false"}">${icon("chevron")}${g.name} <span>${num(g.apps)} apps</span></button></td>${PILLARS.map((p) => barCell(g, p))}</tr>${isOpen ? g.rows.map(appRow) : ""}`;
}

/** The table for a model and the set of open group names. Pure. */
export function heatTable(m, openSet) {
  return html`<div class="tw"><table class="heat" data-table="heatmap"><thead><tr><th>${HEATMAP_LEAD_HEADS[0]}</th><th>${HEATMAP_LEAD_HEADS[1]}</th>${PILLARS.map((p) => html`<th class="hp pc-${p}">${PILLAR_LABEL[p]}</th>`)}</tr></thead><tbody>${m.groups.map((g) => groupRows(g, openSet.has(g.name)))}</tbody></table></div>`;
}

/** The lens content: the table, or the empty state. Pure. */
export function heatView(m, openSet, all) {
  return m.total ? heatTable(m, openSet) : emptyView(all);
}

/** The open groups for a model: all of them for a small result, else the remembered set. */
function shownFor(m) {
  if (open === null && m.total) open = new Set([m.groups[0].name]);
  return isSmall(m) ? new Set(m.groups.map((g) => g.name).filter((n) => !closedSmall.has(n))) : (open || new Set());
}

/** The Heatmap lens for the filtered rows. `all` is the size of the register in scope. */
export function heatLens(rows, all) {
  const m = heatmapModel(rows);
  return html`<div class="lens-heat" data-lens-body="heatmap">${heatView(m, shownFor(m), all)}</div>`;
}

/** Open or close one group (the page redraws afterwards). */
export function toggleGroup(rows, name) {
  const m = heatmapModel(rows);
  if (isSmall(m)) {
    if (closedSmall.has(name)) closedSmall.delete(name); else closedSmall.add(name);
  } else {
    if (open === null) open = new Set();
    if (open.has(name)) open.delete(name); else open.add(name);
  }
}

/** A filter change: every small group shows open again. */
export function resetClosed() { closedSmall = new Set(); }

/** Test seam. */
export function __resetHeatmapForTest() {
  open = null;
  closedSmall = new Set();
}
