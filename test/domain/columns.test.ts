import { describe, expect, it } from "vitest";
import { COLUMNS, COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS, choiceOf, toggleColumnKey, visibleColumnDefs } from "../../src/domain/columns";

describe("column registry", () => {
  it("matches the lx3 COLDEF keys, labels and order", () => {
    expect(COLUMNS.map((c) => [c.key, c.label])).toEqual([
      ["n", "Application"], ["d", "Domain"], ["sd", "Subdomain"], ["g", "Support group"], ["t", "Tier"], ["lc", "Lifecycle"],
      ["o", "Owner"], ["so", "Security officer"], ["ty", "Typology"], ["h", "Hosting"], ["st", "Status"], ["q", "Completeness"],
    ]);
    expect(DEFAULT_COLUMN_KEYS).toEqual(["n", "d", "t", "lc", "o", "so", "st"]);
  });

  it("fixes Application so it cannot be hidden", () => {
    expect(COLUMN_BY_KEY.n!.fixed).toBe(true);
    expect(COLUMNS.filter((c) => c.fixed).map((c) => c.key)).toEqual(["n"]);
    expect(toggleColumnKey([], "n")).toEqual([]);
    expect(visibleColumnDefs(["-n"]).map((c) => c.key)).toContain("n");
  });

  it("applies signed deviations", () => {
    expect(visibleColumnDefs([]).map((c) => c.key)).toEqual(DEFAULT_COLUMN_KEYS);
    expect(visibleColumnDefs(["-d", "+h"]).map((c) => c.key)).toEqual(["n", "t", "lc", "o", "so", "h", "st"]);
    expect(toggleColumnKey([], "h")).toEqual(["+h"]);
    expect(toggleColumnKey(["+h"], "h")).toEqual([]);
    expect(toggleColumnKey([], "d")).toEqual(["-d"]);
    expect(choiceOf(["-zzz", "+h"])).toEqual({ off: [], on: ["h"] });
  });

  it("shows a hidden-by-default column that is the sort key", () => {
    expect(visibleColumnDefs([], "h").map((c) => c.key)).toContain("h");
  });
});

describe("one lifecycle key (review fix)", () => {
  it("treats a hyphenated lifecycle like the underscore and spaced forms", async () => {
    const { lifecycleLabel } = await import("../../src/domain/facets");
    const { lifecycleIndex } = await import("../../src/domain/columns");
    for (const v of ["End-of-life", "End of life", "END_OF_LIFE"]) {
      expect(lifecycleLabel(v), v).toBe("End of life");
      expect(lifecycleIndex(v), v).toBe(lifecycleIndex("END_OF_LIFE"));
    }
    expect(lifecycleIndex("END_OF_LIFE")).toBeLessThan(9);
  });
});
