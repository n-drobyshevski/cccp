import { describe, expect, it } from "vitest";
import * as N from "../../src/domain/normalize";
import { ZONES, useZone } from "./tz";

describe.each(ZONES)("normalize under %s", (tz) => {
  useZone(tz);

  it("never reads inherited Object keys as words or units", () => {
    for (const w of ["constructor", "Constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(N.level(w)).toBeNull();
      expect(N.hours("4 " + w)).toBeNull();
    }
    expect(N.level("High")).toBe(3);
    expect(N.hours("2 days")).toBe(48);
  });

  it("reads days in both formats", () => {
    expect(N.day("2026-03-04")).toBe("2026-03-04");
    expect(N.day("04/03/2026")).toBe("2026-03-04");
    expect(N.day("2026-03-04 00:00")).toBe("2026-03-04");
    expect(N.day("soon")).toBeNull();
    expect(N.day("")).toBeNull();
    expect(N.day(null)).toBeNull();
  });

  it("reads yes/no in English and French", () => {
    for (const y of ["yes", "Yes", "YES", "oui", "Oui", " y ", "true", "1", true, 1]) expect(N.bool(y), String(y)).toBe(true);
    for (const n of ["no", "No", "non", "NON", "n", "false", "0", false, 0]) expect(N.bool(n), String(n)).toBe(false);
    for (const u of ["", "  ", null, undefined, "maybe", "peut-être", 2]) expect(N.bool(u as never), String(u)).toBeNull();
  });

  it("reads tiers", () => {
    expect([1, "2", "T3", "Tier 4", "3.0", " 1 "].map(N.tier)).toEqual([1, 2, 3, 4, 3, 1]);
    for (const u of [0, 5, "", null, "T9", "x", 2.5, "10"]) expect(N.tier(u as never), String(u)).toBeNull();
  });

  it("reads CIAT levels", () => {
    expect([1, "2", "Level 3", "L4", "High", "critical"].map(N.level)).toEqual([1, 2, 3, 4, 3, 4]);
    expect(N.level("")).toBeNull();
    expect(N.level(7)).toBeNull();
  });

  it("reads hours with units", () => {
    expect(N.hours(4)).toBe(4);
    expect(N.hours("4")).toBe(4);
    expect(N.hours("4h")).toBe(4);
    expect(N.hours("4 hours")).toBe(4);
    expect(N.hours("1 hour")).toBe(1);
    expect(N.hours("90 min")).toBe(1.5);
    expect(N.hours("30 minutes")).toBe(0.5);
    expect(N.hours("2 days")).toBe(48);
    expect(N.hours("1d")).toBe(24);
    expect(N.hours("1 week")).toBe(168);
    expect(N.hours("1,5 h")).toBe(1.5);
    expect(N.hours("0")).toBe(0);
    for (const u of ["", null, "soon", "4 parsecs", -1, "12:30"]) expect(N.hours(u as never), String(u)).toBeNull();
  });

  it("reads the DRP result", () => {
    expect(N.drpResult("Passed")).toBe("passed");
    expect(N.drpResult("OK")).toBe("passed");
    expect(N.drpResult("Réussi")).toBe("passed");
    expect(N.drpResult("Failed")).toBe("failed");
    expect(N.drpResult("échec")).toBe("failed");
    expect(N.drpResult("Not passed")).toBe("failed");
    expect(N.drpResult("")).toBeNull();
    expect(N.drpResult("partial")).toBeNull();
  });

  it("counts findings in text", () => {
    expect(N.findingCount("2 major findings", "major")).toBe(2);
    expect(N.findingCount("1 critical", "critical")).toBe(1);
    expect(N.findingCount("1 critical, 3 high", "high")).toBe(3);
    expect(N.findingCount("1 critical, 3 high", "critical")).toBe(1);
    expect(N.findingCount("critical: 2", "critical")).toBe(2);
    expect(N.findingCount("Critical", "critical")).toBe(1);
    expect(N.findingCount("no critical finding", "critical")).toBe(0);
    expect(N.findingCount("0 high", "high")).toBe(0);
    expect(N.findingCount("None", "critical")).toBe(0);
    expect(N.findingCount("1 medium", "high")).toBe(0);
    expect(N.findingCount("2 highlights", "high")).toBe(0);
    expect(N.findingCount("2 critical and 1 critical", "critical")).toBe(3);
    expect(N.findingCount("", "critical")).toBeNull();
    expect(N.findingCount(null, "critical")).toBeNull();
  });

  it("reads text and blank", () => {
    expect(N.text("  hi ")).toBe("hi");
    expect(N.text("   ")).toBeNull();
    expect(N.text(null)).toBeNull();
    expect(N.text(3)).toBe("3");
    expect(N.isBlank(" ")).toBe(true);
    expect(N.isBlank(0)).toBe(false);
  });
});

describe("negations (review fixes)", () => {
  it("reads a negated pass as a failed DRP test", () => {
    for (const v of ["Not OK", "Non réussi", "Not successful", "Pas OK", "Not passed"]) expect(N.drpResult(v), v).toBe("failed");
    for (const v of ["OK", "Réussi", "Successful"]) expect(N.drpResult(v), v).toBe("passed");
  });
  it("counts a stated none as zero findings", () => {
    const c = (t: string, w: string) => N.findingCount(t, w);
    expect(c("No high or critical findings", "critical")).toBe(0);
    expect(c("No high or critical findings", "high")).toBe(0);
    expect(c("No critical or high findings", "high")).toBe(0);
    expect(c("Critical: none", "critical")).toBe(0);
    expect(c("High: none", "high")).toBe(0);
    expect(c("critical - 0", "critical")).toBe(0);
    expect(c("2 non-critical findings", "critical")).toBe(0);
    expect(c("Critical: 0, High: none", "high")).toBe(0);
    // controls
    expect(c("critical: 2", "critical")).toBe(2);
    expect(c("1 critical and 3 high", "high")).toBe(3);
    expect(c("No critical, 2 high", "high")).toBe(2);
    expect(c("critical", "critical")).toBe(1);
  });
});
