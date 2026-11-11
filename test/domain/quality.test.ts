import { describe, expect, it } from "vitest";
import { addDays } from "../../src/domain/dates";
import { FIELDS } from "../../src/domain/fields";
import { completeness, QF, qualityLevel, reviewSeal } from "../../src/domain/quality";
import { mk } from "./mk";

describe("completeness", () => {
  it("QF covers exactly the mandatory fields", () => {
    const qf = QF.flatMap((g) => g.items.map((i) => i.field)).sort();
    expect(qf).toEqual(FIELDS.filter((f) => f.mandatory).map((f) => f.key).sort());
    expect(qf).toHaveLength(17);
  });

  it("an empty application is 0%, every group 0%", () => {
    const c = completeness(mk());
    expect(c).toMatchObject({ pct: 0, filled: 0, total: 17 });
    expect(c.groups.map((g) => g.pct)).toEqual([0, 0, 0, 0, 0]);
    expect(c.missing).toHaveLength(17);
  });

  it("a full application is 100%", () => {
    const c = completeness(mk({
      exposed: false, lastPentest: "2026-01-01", securityOfficer: "A", ciat: { c: 1, i: null, a: null, t: null }, personalData: false,
      securityCheck: "2026-01-01", lastAudit: "2026-01-01", mtd: 1, rto: 1, rpo: 0, lastDrpTest: "2026-01-01", tier: 1,
      hosting: "Cloud", typology: "T", sso: false, owner: "O", backupOwner: "B",
    }));
    expect(c.pct).toBe(100);
    expect(c.missing).toEqual([]);
    expect(c.groups.every((g) => g.pct === 100)).toBe(true);
  });

  it("matches hand-computed percentages (false and 0 count as filled)", () => {
    // Cyber 2/3 = 67, Compliance 1/4 = 25, Continuity 3/4 = 75, Platform 0/4 = 0, People 1/2 = 50; total 7/17 = 41
    const c = completeness(mk({
      exposed: false, lastPentest: "2026-01-01", ciat: { c: null, i: 3, a: 3, t: 3 }, personalData: true,
      mtd: 0, rto: 4, rpo: 8, owner: "O",
    }));
    expect(c.groups.map((g) => g.pct)).toEqual([67, 25, 75, 0, 50]);
    expect(c.filled).toBe(7);
    expect(c.pct).toBe(41);
    expect(c.missing).toContain("CIAT levels");
    expect(c.missing).toContain("Security officer");
    expect(c.missing).not.toContain("Last pentest");
    // Blank strings are missing
    expect(completeness(mk({ owner: "" })).filled).toBe(0);
  });

  it("level thresholds: below 50 bad, below 80 warn, else ok", () => {
    expect([0, 49, 50, 79, 80, 100].map(qualityLevel)).toEqual(["bad", "bad", "warn", "warn", "ok", "ok"]);
  });
});

describe("reviewSeal", () => {
  it("an unreadable date reads as 'Review needed', matching the co.review rule", () => {
    expect(reviewSeal(mk({ securityCheck: "not a date" }), 12, TODAY).state).toBe("need");
  });

  const TODAY = "2026-11-11";
  it("no check date needs review", () => {
    expect(reviewSeal(mk(), 12, TODAY)).toEqual({ state: "need", label: "Review needed", reason: "no-check" });
  });
  it("flips exactly at the months boundary (30.4375 days a month)", () => {
    // 12 months = 365.25 days: 365 days is current, 366 is stale
    expect(reviewSeal(mk({ securityCheck: addDays(TODAY, -365)! }), 12, TODAY).state).toBe("done");
    expect(reviewSeal(mk({ securityCheck: addDays(TODAY, -366)! }), 12, TODAY)).toMatchObject({ state: "need", reason: "stale" });
    // 6 months = 182.625 days
    expect(reviewSeal(mk({ securityCheck: addDays(TODAY, -182)! }), 6, TODAY).state).toBe("done");
    expect(reviewSeal(mk({ securityCheck: addDays(TODAY, -183)! }), 6, TODAY).state).toBe("need");
    expect(reviewSeal(mk({ securityCheck: TODAY }), 1, TODAY)).toEqual({ state: "done", label: "Reviewed", reason: "current" });
  });
  it("agrees with the co.review age test for a classified application", () => {
    for (let d = 300; d < 420; d += 7) {
      const a = mk({ ciat: { c: 1, i: 1, a: 1, t: 1 }, securityCheck: addDays(TODAY, -d)! });
      expect(reviewSeal(a, 12, TODAY).state === "need").toBe(d / 30.4375 > 12);
    }
  });
  it("an unreadable date needs review", () => {
    expect(reviewSeal(mk({ securityCheck: "soon" }), 12, TODAY).state).toBe("need");
  });
});
