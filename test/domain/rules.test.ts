import { describe, expect, it } from "vitest";
import { addDays } from "../../src/domain/dates";
import { cleanRules, census, DEFAULT_RULES, evaluate, evaluateAll, noData, RULES, RULE_BY_ID, ruleCounts, validateRules, worst } from "../../src/domain/rules";
import type { PillarResult } from "../../src/domain/rules";
import type { AppRecord, Pillar, RulesSettings, Status } from "../../src/domain/types";
import { PILLARS } from "../../src/domain/types";
import { mk } from "./mk";
import apps60 from "../fixtures/apps60.json";

const TODAY = "2026-11-11";

const R = (): RulesSettings => JSON.parse(JSON.stringify(DEFAULT_RULES));
const test = (id: string, a: AppRecord, rules = R()) => ruleCounts([a], rules, TODAY)[id] === 1;
const CI = { c: 2, i: 2, a: 2, t: 2 } as AppRecord["ciat"];

// [rule id, app that fires, app that does not fire, null-ish app (unknown input) that does not fire or fires by design]
const CASES: Array<[string, Partial<AppRecord>, Partial<AppRecord>, Partial<AppRecord>?]> = [
  ["cy.noOfficer", {}, { securityOfficer: "Ann" }],
  ["cy.exposedUntested", { exposed: true }, { exposed: true, lastPentest: "2026-01-01" }, { exposed: null }],
  ["cy.critical", { findingsCritical: 2 }, { findingsCritical: 0, findingsText: "1 critical" }, {}],
  ["cy.critical", { findingsText: "has a critical issue" }, { findingsText: "2 low" }],
  ["cy.high", { findingsHigh: 1 }, { findingsHigh: 0 }, {}],
  ["cy.high", { findingsText: "one high" }, { findingsText: "all low" }],
  ["cy.pentestAge", { lastPentest: "2025-01-01" }, { lastPentest: "2026-01-01" }, { lastPentest: "not a date" }],
  ["co.majorAudit", { auditMajor: 1 }, { auditMajor: 0, auditResult: "major" }, {}],
  ["co.majorAudit", { auditResult: "2 Major findings" }, { auditResult: "Passed" }],
  ["co.review", { ciat: CI }, { ciat: CI, securityCheck: "2026-06-01" }, { securityCheck: null }],
  ["co.review", { ciat: CI, securityCheck: "2024-06-01" }, { ciat: CI, securityCheck: "2026-11-11" }],
  ["ct.drpMissing", { rto: 4, tier: 1 }, { rto: 4, tier: 3 }, { rto: 4, tier: null }],
  ["ct.drpMissing", { mtd: 4, tier: 2 }, { mtd: 4, tier: 2, lastDrpTest: "2026-01-01" }, { tier: 1 }],
  ["ct.drpNeverTested", { rto: 4, tier: 3 }, { rto: 4, tier: 1 }, {}],
  ["ct.drpNeverTested", { rto: 4, tier: null }, { rto: 4, tier: null, lastDrpTest: "2026-01-01" }],
  ["co.review", { ciat: CI, securityCheck: "not a date" }, { ciat: CI, securityCheck: "2026-06-01" }],
  ["ct.drpFailed", { drpResult: "failed" }, { drpResult: "passed" }, { drpResult: null }],
  ["ct.drpAge", { lastDrpTest: "2024-01-01" }, { lastDrpTest: "2025-06-01" }, { lastDrpTest: "garbage" }],
  ["pl.eol", { lifecycle: "END_OF_LIFE" }, { lifecycle: "PRODUCTION" }, { lifecycle: null }],
  ["pl.eol", { lifecycle: "end of support" }, { lifecycle: "BETA" }],
  ["pl.decommissioning", { lifecycle: "DECOMMISSIONING" }, { lifecycle: "END_OF_LIFE" }, { lifecycle: null }],
  ["pl.noSso", { sso: false }, { sso: true }, { sso: null }],
];

describe("rule catalogue", () => {
  it("lists every id once, with the spec pillars, levels and toggles", () => {
    expect(RULES.map((r) => r.id)).toEqual([
      "cy.noOfficer", "cy.exposedUntested", "cy.critical", "cy.high", "cy.pentestAge",
      "co.majorAudit", "co.review",
      "ct.drpMissing", "ct.drpNeverTested", "ct.drpFailed", "ct.drpAge",
      "pl.eol", "pl.decommissioning", "pl.noSso",
    ]);
    expect(RULE_BY_ID["cy.high"]).toMatchObject({ level: "warn", toggle: false });
    expect(RULE_BY_ID["cy.critical"]).toMatchObject({ level: "bad", toggle: true });
    expect(RULE_BY_ID["pl.decommissioning"]).toMatchObject({ level: "warn", toggle: false });
  });

  it("every rule has at least a fires and a not-fires case, and a null case", () => {
    for (const r of RULES) expect(CASES.filter((c) => c[0] === r.id).length, r.id).toBeGreaterThanOrEqual(1);
    // cy.noOfficer fires on the null app by design; it is pinned by the null-app test below.
    const FIRES_ON_NULL = ["cy.noOfficer"];
    for (const r of RULES)
      expect(FIRES_ON_NULL.includes(r.id) || CASES.some((c) => c[0] === r.id && c[3] !== undefined), r.id).toBe(true);
  });

  describe.each(CASES)("%s", (id, fires, quiet, nul) => {
    it("fires", () => expect(test(id, mk(fires))).toBe(true));
    it("does not fire", () => expect(test(id, mk(quiet))).toBe(false));
    if (nul) it("null / unknown input", () => expect(test(id, mk(nul))).toBe(false));
  });

  it("the null app fires only the rules that are about something missing", () => {
    const c = ruleCounts([mk()], R(), TODAY);
    expect(Object.keys(c).filter((k) => c[k] === 1)).toEqual(["cy.noOfficer"]);
  });

  it("months and tiers boundaries", () => {
    const rules = R();
    rules.rules["cy.pentestAge"]!.months = 18;
    expect(test("cy.pentestAge", mk({ lastPentest: addDays(TODAY, -547)! }), rules)).toBe(false); // just under 18 months
    expect(test("cy.pentestAge", mk({ lastPentest: addDays(TODAY, -548)! }), rules)).toBe(true);
    rules.rules["ct.drpMissing"]!.tiers = [3];
    expect(test("ct.drpMissing", mk({ rto: 1, tier: 3 }), rules)).toBe(true);
    expect(test("ct.drpMissing", mk({ rto: 1, tier: 1 }), rules)).toBe(false);
    expect(test("ct.drpNeverTested", mk({ rto: 1, tier: 1 }), rules)).toBe(true);
  });
});

const STATUS_RANK: Record<Status, number> = { bad: 3, warn: 2, none: 1, ok: 0 };
const apps = apps60 as unknown as AppRecord[];

/** mulberry32: a small seeded generator so the property run is reproducible. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pillar semantics", () => {
  const ids = (p: PillarResult) => p.fired;

  it("worst() ranks bad > warn > none > ok", () => {
    expect(worst([])).toBe("ok");
    expect(worst(["ok", "none"])).toBe("none");
    expect(worst(["none", "warn", "ok"])).toBe("warn");
    expect(worst(["warn", "bad", "none"])).toBe("bad");
  });

  it("worst-wins and why-order hold for fixture apps and seeded random apps", () => {
    const rnd = seeded(12345);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const gen = (): AppRecord => mk({
      securityOfficer: pick([null, "Ann"]), exposed: pick([null, true, false]),
      lastPentest: pick([null, "2024-01-01", "2026-05-01", "junk"]),
      findingsCritical: pick([null, 0, 2]), findingsHigh: pick([null, 0, 1]),
      findingsText: pick([null, "all low", "one high", "critical"]),
      auditMajor: pick([null, 0, 1]), auditResult: pick([null, "Passed", "major"]),
      ciat: pick([null, CI]), securityCheck: pick([null, "2024-01-01", "2026-09-01", "junk"]),
      rto: pick([null, 4]), mtd: pick([null, 2]), tier: pick([null, 1, 2, 3, 4]),
      lastDrpTest: pick([null, "2023-01-01", "2026-01-01"]), drpResult: pick([null, "passed", "failed"]),
      lifecycle: pick([null, "PRODUCTION", "END_OF_LIFE", "DECOMMISSIONING"]), sso: pick([null, true, false]),
      typology: pick([null, "Web"]), hosting: pick([null, "Cloud"]),
    } as Partial<AppRecord>);
    const rand: AppRecord[] = Array.from({ length: 400 }, gen);
    for (const withRandomRules of [false, true]) for (const a of [...apps, ...rand]) {
      const rules = R();
      if (withRandomRules) {
        for (const t of RULES.filter((x) => x.toggle)) rules.rules[t.id]!.on = rnd() > 0.4;
        rules.rules["cy.pentestAge"]!.months = pick([1, 6, 18, 60]);
        rules.rules["co.review"]!.months = pick([1, 6, 12]);
        rules.rules["ct.drpAge"]!.months = pick([6, 24]);
        rules.rules["ct.drpMissing"]!.tiers = pick([[1], [1, 2], [3, 4]]);
      }
      const s = evaluate(a, rules, TODAY);
      for (const p of PILLARS as readonly Pillar[]) {
        const res = s[p];
        const fired = RULES.filter((r) => r.pillar === p && (!r.toggle || rules.rules[r.id]?.on !== false) && ruleCounts([a], rules, TODAY)[r.id] === 1);
        expect(ids(res)).toEqual(fired.map((r) => r.id)); // catalogue order
        if (fired.length) {
          const top = Math.max(...fired.map((r) => (r.level === "bad" ? 3 : 2)));
          expect(STATUS_RANK[res.status]).toBe(top);
          expect(res.why).toBe(fired.find((r) => (r.level === "bad" ? 3 : 2) === top)!.id);
        } else {
          expect(res.why).toBeNull();
          expect(res.status).toBe(noData(p, a) ? "none" : "ok");
        }
      }
      expect(s.worst).toBe(worst(PILLARS.map((p) => s[p].status)));
    }
  });

  it("'none' appears exactly when no rule fired and the no-data predicate holds", () => {
    let none = 0;
    for (const a of apps) {
      const s = evaluate(a, R(), TODAY);
      for (const p of PILLARS) {
        expect(s[p].status === "none").toBe(s[p].fired.length === 0 && noData(p, a));
        if (s[p].status === "none") none++;
      }
    }
    expect(none).toBeGreaterThan(0);
  });

  it("covers every status in the fixture", () => {
    const seen = new Set<string>();
    for (const s of evaluateAll(apps, R(), TODAY)) for (const p of PILLARS) seen.add(s[p].status);
    expect([...seen].sort()).toEqual(["bad", "none", "ok", "warn"]);
  });

  it("why is the first of several bad rules, and warn is outranked by bad", () => {
    const a = mk({ exposed: true, securityOfficer: null, findingsCritical: 1, findingsHigh: 1, lastPentest: null });
    const s = evaluate(a, R(), TODAY).cyber;
    expect(s).toMatchObject({ status: "bad", why: "cy.noOfficer" });
    expect(s.fired).toEqual(["cy.noOfficer", "cy.exposedUntested", "cy.critical", "cy.high"]);
    const w = evaluate(mk({ securityOfficer: "A", lastPentest: "2026-01-01", findingsHigh: 2 }), R(), TODAY).cyber;
    expect(w).toMatchObject({ status: "warn", why: "cy.high", sentence: "A high finding is open" });
  });

  it("the no-data and ok sentences", () => {
    const n = evaluate(mk({ securityOfficer: "A" }), R(), TODAY);
    expect([n.cyber.sentence, n.compliance.sentence, n.continuity.sentence, n.platform.sentence]).toEqual(
      ["No pentest on record", "Not classified", "No DRP data", "Typology not set"]);
    expect(n.compliance.status).toBe("none");
    const ok = evaluate(mk({ securityOfficer: "A", lastPentest: "2026-01-01", findingsText: "None", ciat: CI, securityCheck: "2026-06-01", rto: 1, lastDrpTest: "2026-05-01", drpResult: "passed", typology: "App", tier: 3 }), R(), TODAY);
    expect([ok.cyber.sentence, ok.compliance.sentence, ok.continuity.sentence, ok.platform.sentence]).toEqual(
      ["Pentest clean", "Classification validated", "DRP tested, passed", "Complete"]);
    expect(ok.worst).toBe("ok");
    expect(evaluate(mk({ securityOfficer: "A", lastPentest: "2026-01-01", findingsText: "2 low" }), R(), TODAY).cyber.sentence).toBe("Pentest done, 2 low");
  });

  it("sort key is bad*100 + warn*10", () => {
    const s = evaluate(mk({ lifecycle: "END_OF_LIFE", drpResult: "failed", sso: false }), R(), TODAY);
    // cyber bad (no officer), continuity bad, platform bad, compliance none
    expect(s.sort).toBe(300);
    const w = evaluate(mk({ securityOfficer: "A", lastPentest: "2026-01-01", findingsHigh: 1, sso: false, typology: "T" }), R(), TODAY);
    expect(w.sort).toBe(20);
  });
});

describe("toggles, counts and months", () => {
  const toggles = RULES.filter((r) => r.toggle);

  it("toggle-off removes exactly that rule", () => {
    for (const t of toggles) {
      const off = R();
      off.rules[t.id]!.on = false;
      const a = evaluateAll(apps, R(), TODAY);
      const b = evaluateAll(apps, off, TODAY);
      apps.forEach((_, i) => {
        for (const p of PILLARS) {
          const expectFired = a[i]![p].fired.filter((x) => x !== t.id);
          expect(b[i]![p].fired, t.id).toEqual(expectFired);
          if (!expectFired.length) expect(["ok", "none"]).toContain(b[i]![p].status);
        }
      });
    }
    expect(toggles.length).toBe(7);
  });

  it("a fixed rule ignores a stored on:false", () => {
    const rules = R();
    (rules.rules as Record<string, object>)["cy.high"] = { on: false };
    expect(evaluate(mk({ findingsHigh: 1, securityOfficer: "A" }), rules, TODAY).cyber.why).toBe("cy.high");
  });

  it("ruleCounts ignores toggles and equals brute force", () => {
    const rules = R();
    for (const t of toggles) rules.rules[t.id]!.on = false;
    rules.rules["ct.drpMissing"]!.tiers = [1, 3];
    const c = ruleCounts(apps, rules, TODAY);
    const clean = cleanRules(rules);
    for (const r of RULES) {
      const p = { months: clean.rules[r.id]?.months ?? r.params?.months, tiers: clean.rules[r.id]?.tiers ?? r.params?.tiers };
      let n = 0;
      for (const a of apps) if (r.test(a, p, TODAY)) n++;
      expect(c[r.id], r.id).toBe(n);
    }
    expect(c["cy.noOfficer"]).toBe(ruleCounts(apps, R(), TODAY)["cy.noOfficer"]);
    expect(Object.keys(c)).toEqual(RULES.map((r) => r.id));
  });

  it("raising months never increases the age counts", () => {
    for (const id of ["cy.pentestAge", "co.review", "ct.drpAge"]) {
      let prev = Infinity;
      for (let m = 1; m <= 120; m++) {
        const rules = R();
        rules.rules[id]!.months = m;
        const n = ruleCounts(apps, rules, TODAY)[id]!;
        expect(n, id + " at " + m).toBeLessThanOrEqual(prev);
        prev = n;
      }
      expect(ruleCounts(apps, (() => { const x = R(); x.rules[id]!.months = 1; return x; })(), TODAY)[id]).toBeGreaterThan(0);
    }
  });

  it("census counts pillars, worst and tiers", () => {
    const c = census(apps, R(), TODAY);
    expect(c.version).toBe(1);
    expect(c.total).toBe(60);
    for (const p of PILLARS) expect(Object.values(c.pillars[p]).reduce((x, y) => x + y, 0)).toBe(60);
    expect(Object.values(c.worst).reduce((x, y) => x + y, 0)).toBe(60);
    expect(Object.values(c.tiers).reduce((x, y) => x + y, 0)).toBe(60);
    expect(c.tiers["1"]).toBe(apps.filter((a) => a.tier === 1).length);
    expect(c.tiers.none).toBe(apps.filter((a) => a.tier === null).length);
    const e = evaluateAll(apps, R(), TODAY);
    expect(c.pillars.cyber.bad).toBe(e.filter((s) => s.cyber.status === "bad").length);
  });
});

describe("cleanRules and validateRules", () => {
  it("drops unknown ids and clamps", () => {
    const c = cleanRules({ version: 1, rules: {
      "nope.rule": { on: false }, "cy.pentestAge": { months: 999 }, "co.review": { months: -5 },
      "ct.drpAge": { months: "30" }, "ct.drpMissing": { tiers: [0, 9, 2, 2, 3] },
    } });
    expect(Object.keys(c.rules).sort()).toEqual(Object.keys(DEFAULT_RULES.rules).sort());
    expect(c.rules["cy.pentestAge"]!.months).toBe(120);
    expect(c.rules["co.review"]!.months).toBe(1);
    expect(c.rules["ct.drpAge"]!.months).toBe(30);
    expect(c.rules["ct.drpMissing"]!.tiers).toEqual([1, 2, 3, 4]);
    expect(cleanRules(null)).toEqual(DEFAULT_RULES);
    expect(cleanRules("junk")).toEqual(DEFAULT_RULES);
    expect(cleanRules(c)).toEqual(c);
  });

  it("evaluating with unclean rules behaves as if cleaned", () => {
    const raw = { version: 1, rules: { "cy.pentestAge": { months: 9999 } } } as unknown as RulesSettings;
    expect(ruleCounts(apps, raw, TODAY)).toEqual(ruleCounts(apps, cleanRules(raw), TODAY));
  });

  it("validateRules gives sentences", () => {
    expect(validateRules(DEFAULT_RULES)).toEqual([]);
    expect(validateRules({ rules: { "ct.drpMissing": { tiers: [] } } })).toHaveLength(1);
    expect(validateRules({ rules: { "cy.pentestAge": { months: 0 } } })[0]).toMatch(/between 1 and 120/);
    expect(validateRules({ rules: { "ct.drpMissing": { tiers: [7] } } })[0]).toMatch(/T1 to T4/);
    expect(validateRules(null)).toEqual([]);
  });
});
