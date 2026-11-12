// The Status rules tab as pure code: the live counts under the draft equal ruleCounts, toggles
// map to on/off, months are clamped, fixed rules have no switch, the tier rule needs a tier, and
// every sentence and value is escaped.
import { describe, expect, it } from "vitest";
import { RULE_TITLE, clampMonths, cleanTiers, draftCounts, editRule, ruleChangeNotes, rulesOfDraft, rulesView, toggleTier } from "../../src/client/pages/settings/rules.js";
import { errorsOf, isDirty, newSession, toPatch } from "../../src/client/pages/settings/draft.js";
import { RULES, ruleCounts } from "../../src/domain/rules";
import { applyPatch, makeDefaultSettings } from "../../src/domain/settings";
import { fixtureRows, TODAY } from "../domain/rows";

const rows = fixtureRows();
const apps = rows.map((r) => r.app);
const session = () => newSession({ settings: makeDefaultSettings(), cfgGen: 1, headers: {}, examples: {} }, "");
const view = (s, over) => String(rulesView({ session: s, rows, today: TODAY, errors: errorsOf(s).errors, ...(over || {}) }));
const count = (out, id) => Number(new RegExp('data-cnt="' + id.replace(".", "\\.") + '"><b>([\\d,]+)</b>').exec(out)[1].replace(",", ""));

describe("live counts", () => {
  it("equal ruleCounts of the draft's parameters, for every rule, before and after edits", () => {
    let s = session();
    expect(draftCounts(rows, s, TODAY)).toEqual(ruleCounts(apps, makeDefaultSettings().rules, TODAY));
    s = editRule(s, "cy.pentestAge", "months", 3);
    s = editRule(s, "co.review", "months", 2);
    s = editRule(s, "ct.drpAge", "months", 6);
    s = toggleTier(s, "ct.drpMissing", 3);
    const want = ruleCounts(apps, applyPatch(makeDefaultSettings(), toPatch(s.savedDraft, s.draft)).rules, TODAY);
    expect(draftCounts(rows, s, TODAY)).toEqual(want);
    const out = view(s);
    for (const r of RULES) expect(count(out, r.id)).toBe(want[r.id]);
  });

  it("a shorter threshold never lowers an age count, and a count moves with the draft", () => {
    const a = draftCounts(rows, session(), TODAY)["cy.pentestAge"];
    const b = draftCounts(rows, editRule(session(), "cy.pentestAge", "months", 1), TODAY)["cy.pentestAge"];
    expect(b).toBeGreaterThanOrEqual(a);
    expect(b).not.toBe(draftCounts(rows, editRule(session(), "cy.pentestAge", "months", 120), TODAY)["cy.pentestAge"]);
  });

  it("switching a rule off dims it but keeps its count", () => {
    const on = view(session());
    const s = editRule(session(), "pl.noSso", "on", false);
    const off = view(s);
    expect(count(off, "pl.noSso")).toBe(count(on, "pl.noSso"));
    expect(off).toMatch(/class="rule off" data-rule-row="pl.noSso"/);
    expect(on).toMatch(/class="rule " data-rule-row="pl.noSso"/);
  });
});

describe("edits", () => {
  it("toggles map to on true or false in the patch", () => {
    const s = editRule(session(), "cy.critical", "on", false);
    expect(toPatch(s.savedDraft, s.draft)).toEqual({ rules: { rules: { "cy.critical": { on: false } } } });
    expect(isDirty(editRule(s, "cy.critical", "on", true))).toBe(false);
  });

  it("months are clamped to 1..120 and rounded", () => {
    expect(clampMonths(0)).toBe(1);
    expect(clampMonths(-5)).toBe(1);
    expect(clampMonths(9999)).toBe(120);
    expect(clampMonths(17.6)).toBe(18);
    expect(clampMonths("abc")).toBe(1);
    expect(editRule(session(), "ct.drpAge", "months", 500).draft["rules.ct.drpAge"].months).toBe(120);
    expect(errorsOf(editRule(session(), "ct.drpAge", "months", 500)).problems).toEqual([]);
  });

  it("tiers stay 1 to 4, ascending and unique; no tier is said in words, not blocked", () => {
    expect(cleanTiers([4, 2, 2, 9, 0])).toEqual([2, 4]);
    let s = toggleTier(session(), "ct.drpMissing", 1);
    expect(s.draft["rules.ct.drpMissing"].tiers).toEqual([2]);
    expect(view(s)).not.toContain("data-no-tier");
    s = toggleTier(s, "ct.drpMissing", 2);
    expect(s.draft["rules.ct.drpMissing"].tiers).toEqual([]);
    expect(view(s)).toContain("Choose at least one tier");
    expect(draftCounts(rows, s, TODAY)["ct.drpMissing"]).toBe(0);
    expect(toPatch(s.savedDraft, s.draft)).toEqual({ rules: { rules: { "ct.drpMissing": { tiers: [] } } } });
  });

  it("rulesOfDraft is the rules section of the draft", () => {
    expect(rulesOfDraft(session().draft)).toEqual(makeDefaultSettings().rules);
  });
});

describe("rows and the change summary", () => {
  it("every rule has a short name, the pillar code in its colour class, its sentence and a live count", () => {
    const out = view(session());
    for (const r of RULES) {
      expect(RULE_TITLE[r.id], r.id).toBeTruthy();
      const at = out.indexOf('data-rule-row="' + r.id + '"');
      const mine = out.slice(at, out.indexOf("</small>", at));
      expect(mine).toContain("<b>" + RULE_TITLE[r.id] + "</b>");
      expect(mine).toContain('class="rc pc-' + r.pillar + '"');
    }
  });
  it("pillars are headed in their own colour class", () => {
    const out = view(session());
    for (const p of ["cyber", "compliance", "continuity", "platform"]) expect(out).toContain('<div class="sgrp rg pc-' + p + '" data-pillar="' + p + '"><h3>');
  });
  it("says what changed with the count before and after", () => {
    const base = session();
    expect(ruleChangeNotes({ session: base, rows, today: TODAY })).toEqual([]);
    const s = editRule(base, "cy.pentestAge", "months", 1);
    const [note] = ruleChangeNotes({ session: s, rows, today: TODAY });
    const b = draftCounts(rows, base, TODAY)["cy.pentestAge"];
    const a = draftCounts(rows, s, TODAY)["cy.pentestAge"];
    expect(note).toBe("Pentest too old: 18 \u2192 1 months (" + b + " \u2192 " + a + (a === 1 ? " app" : " apps") + ")");
    const t = toggleTier(editRule(base, "pl.noSso", "on", false), "ct.drpMissing", 3);
    const notes = ruleChangeNotes({ session: t, rows, today: TODAY });
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.startsWith("No single sign-on"))).toBe("No single sign-on: on \u2192 off");
    expect(notes.find((n) => n.startsWith("No tested DRP"))).toMatch(/^No tested DRP: tiers T1, T2 \u2192 T1, T2, T3/);
  });
});

describe("the view", () => {
  it("shows every catalogue rule under its pillar, with a switch only where the rule has one", () => {
    const out = view(session());
    for (const r of RULES) {
      expect(out).toContain('data-rule-row="' + r.id + '"');
      const row = out.slice(out.indexOf('data-rule-row="' + r.id + '"'));
      const end = row.indexOf('data-rule-row=', 10) < 0 ? row.length : row.indexOf('data-rule-row=', 10);
      const mine = row.slice(0, end);
      if (r.toggle) expect(mine).toContain('data-prop="on"');
      else {
        expect(mine).not.toContain('data-prop="on"');
        expect(mine).toContain("Always on");
      }
    }
    expect((out.match(/data-prop="on"/g) || []).length).toBe(RULES.filter((r) => r.toggle).length);
  });

  it("months rules carry a number input, the tier rule four tier checkboxes, and both mark state", () => {
    const out = view(session());
    expect(out).toMatch(/<input type="number" min="1" max="120" data-rule="cy.pentestAge" data-prop="months"[^>]*value="18"/);
    expect((out.match(/data-act="s-tier"/g) || []).length).toBe(4);
    expect(out).toMatch(/<input type="checkbox" data-act="s-tier" data-trule="ct.drpMissing" data-tier="1"[^>]* checked>/);
    expect(out).toMatch(/<input type="checkbox" data-act="s-tier" data-trule="ct.drpMissing" data-tier="3" data-k="[^"]*"><span>T3/);
    // a tier box is not a rule input: it must not be picked up by the on/off and months handlers
    expect(out).not.toMatch(/data-rule="ct.drpMissing"/);
  });

  it("names the level in words for each rule and has no title attribute", () => {
    const out = view(session());
    expect(out).toMatch(/<span class="lv bad">Gap<\/span> · /);
    expect(out).toMatch(/<span class="lv warn">Needs attention<\/span> · /);
    expect(out).not.toMatch(/\btitle=/);
  });

  it("escapes a hostile numeric draft value", () => {
    const s = session();
    s.draft["rules.cy.pentestAge"] = { months: '"><img src=x onerror=alert(1)>' };
    expect(view(s)).not.toContain("<img");
  });
});
