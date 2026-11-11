import { describe, expect, it } from "vitest";
import { addDays, compareDays, dayNumber, daysBetween, isIsoDay, monthsBetween, parseDay, relativeAge } from "../../src/domain/dates";
import { ZONES, useZone } from "./tz";

describe.each(ZONES)("dates under %s", (tz) => {
  useZone(tz);

  it("is really running in the zone", () => {
    const off = new Date(2026, 0, 1).getTimezoneOffset();
    expect(off).toBe(tz === "UTC" ? 0 : -840);
  });

  it("parses yyyy-MM-dd and dd/MM/yyyy", () => {
    expect(parseDay("2026-11-11")).toBe("2026-11-11");
    expect(parseDay("2026-1-5")).toBe("2026-01-05");
    expect(parseDay("11/11/2026")).toBe("2026-11-11");
    expect(parseDay("5/1/2026")).toBe("2026-01-05");
    expect(parseDay(" 31/12/2025 ")).toBe("2025-12-31");
    expect(parseDay("2026-11-11 14:30")).toBe("2026-11-11");
    expect(parseDay("2026-11-11T00:00:00Z")).toBe("2026-11-11");
  });

  it("rejects what is not a real date", () => {
    for (const bad of ["", "x", "2026-02-30", "31/02/2026", "2026-13-01", "00/01/2026", "2026/01/05", "11-11-2026", "1899-01-01"]) expect(parseDay(bad)).toBeNull();
    for (const bad of [null, undefined, 5, {}, new Date()]) expect(parseDay(bad as never)).toBeNull();
  });

  it("handles leap days", () => {
    expect(parseDay("29/02/2024")).toBe("2024-02-29");
    expect(parseDay("29/02/2025")).toBeNull();
  });

  it("counts days across month, year and DST-like boundaries", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-11-11", "2026-11-01")).toBe(-10);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(daysBetween("x", "2026-01-01")).toBeNull();
  });

  it("measures months at 30.4375 days", () => {
    expect(monthsBetween("2026-01-01", "2026-01-31")).toBeCloseTo(30 / 30.4375, 10);
    expect(monthsBetween("2025-11-11", "2026-11-11")).toBeCloseTo(365 / 30.4375, 10);
    expect(monthsBetween(null, "2026-11-11")).toBeNull();
  });

  it("adds days", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("nope", 1)).toBeNull();
  });

  it("describes relative age", () => {
    const today = "2026-11-11";
    expect(relativeAge("2026-11-11", today)).toBe("today");
    expect(relativeAge("2026-11-10", today)).toBe("1 day ago");
    expect(relativeAge("2026-10-01", today)).toBe("41 days ago");
    expect(relativeAge("2026-05-11", today)).toBe("6 months ago");
    expect(relativeAge("2024-01-01", today)).toBe("2 years ago");
    expect(relativeAge("2026-11-14", today)).toBe("in 3 days");
    expect(relativeAge(null, today)).toBe("");
  });

  it("compares with unknown first", () => {
    expect(compareDays("2026-01-02", "2026-01-01")).toBeGreaterThan(0);
    expect(compareDays(null, "2026-01-01")).toBeLessThan(0);
    expect(compareDays(null, null)).toBe(0);
  });

  it("isIsoDay accepts only the canonical form", () => {
    expect(isIsoDay("2026-11-11")).toBe(true);
    expect(isIsoDay("2026-1-1")).toBe(false);
    expect(isIsoDay("11/11/2026")).toBe(false);
  });
});
