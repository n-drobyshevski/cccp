// Status rules tab: the catalogue by pillar, each rule with its dot, its sentence (months and
// tiers are inline controls), a live "<n> apps" and, for the rules that have one, an on/off
// switch. The counts are ruleCounts over the whole register with the DRAFT's parameters, so they
// move before anything is saved; the switches do not change a count (a rule shows what it would
// do before it is switched on). Fixed rules have no switch. This module holds the draft edits as
// pure functions; page.js wires the controls (data-rule, data-prop) to them.
import { html } from "../../lib/html.js";
import { num } from "../../lib/format.js";
import { dot } from "../../components/dots.js";
import { PILLAR_LABEL, STATUS_WORD } from "../../../domain/facets";
import { RULE_BY_ID, ruleCounts, rulesOf } from "../../../domain/rules";
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

function aff(id, n) {
  return html`<span class="aff" data-cnt="${id}"><b>${num(n)}</b> ${n === 1 ? "app" : "apps"}</span>`;
}

function monthsCtl(rule, p) {
  const id = rule.id;
  return html`<span class="numu"><input type="number" min="${MONTHS_MIN}" max="${MONTHS_MAX}" data-rule="${id}" data-prop="months" data-type="number" data-k="rm-${id}" value="${p.months}" aria-label="Months for the rule ${rule.sentence({ months: "N" })}"><span>months</span></span>`;
}

function tiersCtl(rule, p) {
  const id = rule.id;
  return html`<span class="tchips" role="group" aria-label="Tiers">${TIERS.map((t) => html`<button type="button" data-act="s-tier" data-rule="${id}" data-tier="${t}" data-k="rt-${t}" aria-pressed="${(p.tiers || []).indexOf(t) >= 0 ? "true" : "false"}">T${t}</button>`)}</span>`;
}

/** The sentence with its inline control: the catalogue's own wording, split where the value goes. */
function sentence(rule, p) {
  if (p.months !== undefined) {
    const [a, b] = rule.sentence({ months: MARK }).split(MARK);
    // The control carries its own "months" unit; the sentence's trailing unit is not repeated.
    return html`${a}${monthsCtl(rule, p)}${b.replace(/^\s*months/, "")}`;
  }
  if (rule.params && rule.params.tiers !== undefined && !rule.paramsFrom) {
    const [a, b] = rule.sentence({ tiers: [MARK] }).split("T" + MARK);
    return html`${a}${tiersCtl(rule, p)}${b}`;
  }
  return rule.sentence(p);
}

function ruleRow(rule, p, count) {
  const on = !rule.toggle || p.on !== false;
  const word = STATUS_WORD[rule.level];
  const swtch = rule.toggle
    ? html`<label class="sw"><input type="checkbox" data-rule="${rule.id}" data-prop="on" data-type="bool" data-k="rs-${rule.id}"${on ? html` checked` : ""} aria-label="Rule on: ${rule.sentence({ months: "N", tiers: [] })}"><span aria-hidden="true"></span></label>`
    : html`<span class="sr-only" data-fixed>Always on</span>`;
  const note = rule.paramsFrom ? html` <small class="mut">· for the tiers not chosen above</small>` : "";
  return html`<div class="rule ${on ? "" : "off"}" data-rule-row="${rule.id}">${dot(rule.level)}<span class="sr-only">${word}: </span><span class="txt">${sentence(rule, p)}${note}</span>${aff(rule.id, count)}${swtch}</div>`;
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

/** ctx: {session, rows, today}. */
export function rulesView(ctx) {
  const counts = draftCounts(ctx.rows, ctx.session, ctx.today);
  const noTier = cleanTiers(paramsOf(RULE_BY_ID["ct.drpMissing"], ctx.session.draft).tiers).length === 0;
  return html`${PILLARS.map((pl) => html`<div class="sgrp" data-pillar="${pl}"><h3>${dot(rulesOf(pl).some((r) => r.level === "bad") ? "bad" : "warn")}${PILLAR_LABEL[pl]}</h3>
    ${rulesOf(pl).map((rule) => {
      const row = ruleRow(rule, paramsOf(rule, ctx.session.draft), counts[rule.id] || 0);
      return rule.id === "ct.drpMissing" && noTier ? html`${row}<small class="warntxt" role="status" data-no-tier>Choose at least one tier, or this rule never fires.</small>` : row;
    })}</div>`)}
    <p class="mut legend"><span class="lg">${dot("bad")}Gap</span><span class="lg">${dot("warn")}Needs attention</span><span>The worst rule that matches sets the dot. Counts use the current data and follow what you change here, before you save.</span></p>`;
}
