// Status rules tab (identity G): the catalogue by pillar under a pillar-coloured heading and rule; each
// rule row has the pillar code, its name with its sentence, its control (an on/off switch, a months
// input or the tier checkboxes T1 to T4) and a live "<n> apps". Fixed rules say "Always on". The
// counts are ruleCounts over the whole register with the DRAFT's parameters, so they move before
// anything is saved; the switches do not change a count (a rule shows what it would do before it is
// switched on). This module holds the draft edits as pure functions; page.js wires the controls
// (data-rule and data-prop, data-trule and data-tier) to them.
import { html } from "../../lib/html.js";
import { num } from "../../lib/format.js";
import { PILLAR_CODE } from "../../components/glyph.js";
import { PILLAR_LABEL, STATUS_WORD } from "../../../domain/facets";
import { RULES, RULE_BY_ID, ruleCounts, rulesOf } from "../../../domain/rules";
import { MONTHS_MAX, MONTHS_MIN } from "../../../domain/settings";
import { PILLARS } from "../../../domain/types";
import { setKey } from "./draft.js";

const TIERS = [1, 2, 3, 4];
const MARK = "\u0001";

/** A months value as the server will keep it: a whole number from 1 to 120. */
export function clampMonths(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return MONTHS_MIN;
  return Math.min(MONTHS_MAX, Math.max(MONTHS_MIN, n));
}

/** The tiers of a list as the server will keep them: 1 to 4, no repeats, ascending. */
export function cleanTiers(list) {
  return TIERS.filter((t) => (list || []).indexOf(t) >= 0);
}

/** The rules section of the draft, as the domain reads it. */
export function rulesOfDraft(draft) {
  const rules = {};
  for (const k of Object.keys(draft)) if (k.indexOf("rules.") === 0) rules[k.slice(6)] = draft[k];
  return { version: 1, rules };
}

/** One edit of one rule's parameter: prop is 'on', 'months' or 'tiers'. Months are clamped. */
export function editRule(session, id, prop, value) {
  const key = "rules." + id;
  const cur = session.draft[key] || {};
  let v = value;
  if (prop === "months") v = clampMonths(value);
  else if (prop === "tiers") v = cleanTiers(value);
  else if (prop === "on") v = value === true;
  return { ...session, draft: setKey(session.draft, key, { ...cur, [prop]: v }) };
}

/** Flip one tier of the tier rule. */
export function toggleTier(session, id, tier) {
  const cur = (session.draft["rules." + id] || {}).tiers || [];
  const next = cur.indexOf(tier) >= 0 ? cur.filter((t) => t !== tier) : cur.concat([tier]);
  return editRule(session, id, "tiers", next);
}

/** {ruleId: n}: how many applications each rule's test is true for, under the draft. */
export function draftCounts(rows, session, today) {
  return ruleCounts(rows.map((r) => r.app), rulesOfDraft(session.draft), today);
}

/** Short names for the catalogue's rules (the sentence says the rest). */
export const RULE_TITLE = {
  "cy.noOfficer": "No security officer", "cy.exposedUntested": "Exposed, never tested", "cy.critical": "Open critical findings",
  "cy.high": "Open high findings", "cy.pentestAge": "Pentest too old",
  "co.majorAudit": "Major audit finding", "co.review": "Classification review overdue",
  "ct.drpMissing": "No tested DRP", "ct.drpNeverTested": "DRP never tested", "ct.drpFailed": "DRP test failed", "ct.drpAge": "DRP test too old",
  "pl.eol": "End of life", "pl.decommissioning": "Decommissioning", "pl.noSso": "No single sign-on",
};
export const ruleTitle = (rule) => RULE_TITLE[rule.id] || rule.sentence({ months: "N", tiers: [] });

function aff(id, n) {
  return html`<span class="aff" data-cnt="${id}"><b>${num(n)}</b> ${n === 1 ? "app" : "apps"}</span>`;
}

function monthsCtl(rule, p) {
  const id = rule.id;
  return html`<span class="numu"><input type="number" min="${MONTHS_MIN}" max="${MONTHS_MAX}" data-rule="${id}" data-prop="months" data-type="number" data-k="rm-${id}" value="${p.months}" aria-label="Months for the rule ${rule.sentence({ months: "N" })}"><span>months</span></span>`;
}

function tiersCtl(rule, p) {
  const id = rule.id;
  return html`<span class="tcks" role="group" aria-label="Tiers for ${ruleTitle(rule)}">${TIERS.map((t) => html`<label class="tck"><input type="checkbox" data-act="s-tier" data-trule="${id}" data-tier="${t}" data-k="rt-${id}-${t}"${(p.tiers || []).indexOf(t) >= 0 ? html` checked` : ""}><span>T${t}</span></label>`)}</span>`;
}

// A rule with a value but no switch is always on; a screen reader hears that too.
const always = html`<span class="sr-only" data-fixed>Always on</span>`;

function control(rule, p, on) {
  if (p.months !== undefined) return html`${monthsCtl(rule, p)}${rule.toggle ? "" : always}`;
  if (rule.params && rule.params.tiers !== undefined && !rule.paramsFrom) return html`${tiersCtl(rule, p)}${rule.toggle ? "" : always}`;
  if (rule.toggle) return html`<label class="sw"><input type="checkbox" data-rule="${rule.id}" data-prop="on" data-type="bool" data-k="rs-${rule.id}"${on ? html` checked` : ""} aria-label="Rule on: ${rule.sentence({ months: "N", tiers: [] })}"><span aria-hidden="true"></span><b class="swt" aria-hidden="true"></b></label>`;
  return html`<span class="fixed" data-fixed>Always on</span>`;
}

function ruleRow(rule, p, count) {
  const on = !rule.toggle || p.on !== false;
  const word = STATUS_WORD[rule.level];
  // A rule with months or tiers and a switch (none today) would show both; the value control wins.
  const note = rule.paramsFrom ? " · for the tiers not chosen above" : "";
  return html`<div class="rule ${on ? "" : "off"}" data-rule-row="${rule.id}"><span class="rc pc-${rule.pillar}" aria-hidden="true">${PILLAR_CODE[rule.pillar]}</span><span class="rt"><b>${ruleTitle(rule)}</b><small><span class="lv ${rule.level}">${word}</span> · ${rule.sentence(p)}${note}</small></span><span class="rx">${control(rule, p, on)}</span>${aff(rule.id, count)}</div>`;
}

/** The parameters of a rule as the draft holds them, with the catalogue defaults beneath. */
function paramsOf(rule, draft) {
  const d = draft["rules." + rule.id] || {};
  const base = rule.params || {};
  const out = {};
  if (rule.toggle) out.on = d.on !== false;
  if (base.months !== undefined) out.months = d.months === undefined ? base.months : d.months;
  if (base.tiers !== undefined) out.tiers = d.tiers === undefined ? base.tiers : d.tiers;
  return out;
}

const tiersText = (t) => ((t || []).length ? (t || []).map((x) => "T" + x).join(", ") : "none");

/**
 * What changed in the rules, one sentence per rule, with the live count before and after:
 * 'Pentest too old: 18 → 24 months (131 → 74 apps)'. Pure; ctx: {session, rows, today}.
 */
export function ruleChangeNotes(ctx) {
  const before = draftCounts(ctx.rows, { draft: ctx.session.savedDraft }, ctx.today);
  const after = draftCounts(ctx.rows, ctx.session, ctx.today);
  const notes = [];
  for (const rule of RULES) {
    const a = paramsOf(rule, ctx.session.savedDraft);
    const b = paramsOf(rule, ctx.session.draft);
    let what = "";
    if (a.months !== b.months) what = a.months + " \u2192 " + b.months + " months";
    else if (tiersText(a.tiers) !== tiersText(b.tiers)) what = "tiers " + tiersText(a.tiers) + " \u2192 " + tiersText(b.tiers);
    else if (a.on !== b.on) what = (a.on ? "on" : "off") + " \u2192 " + (b.on ? "on" : "off");
    if (!what) continue;
    const x = before[rule.id] || 0;
    const y = after[rule.id] || 0;
    notes.push(ruleTitle(rule) + ": " + what + (x !== y ? " (" + num(x) + " \u2192 " + num(y) + " " + (y === 1 ? "app" : "apps") + ")" : ""));
  }
  return notes;
}

/** ctx: {session, rows, today}. */
export function rulesView(ctx) {
  const counts = draftCounts(ctx.rows, ctx.session, ctx.today);
  const noTier = cleanTiers(paramsOf(RULE_BY_ID["ct.drpMissing"], ctx.session.draft).tiers).length === 0;
  return html`${PILLARS.map((pl) => html`<div class="sgrp rg pc-${pl}" data-pillar="${pl}"><h3>${PILLAR_LABEL[pl]}</h3>
    ${rulesOf(pl).map((rule) => {
      const row = ruleRow(rule, paramsOf(rule, ctx.session.draft), counts[rule.id] || 0);
      return rule.id === "ct.drpMissing" && noTier ? html`${row}<small class="warntxt" role="status" data-no-tier>Choose at least one tier, or this rule never fires.</small>` : row;
    })}</div>`)}
    <p class="mut legend"><span class="lg"><i class="sq ls-bad" aria-hidden="true"></i>Gap</span><span class="lg"><i class="sq ls-warn" aria-hidden="true"></i>Needs attention</span><span>The worst rule that matches sets the status. Counts use the current data and follow what you change here, before you save.</span></p>`;
}
