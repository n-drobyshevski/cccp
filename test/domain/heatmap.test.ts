import { describe, expect, it } from "vitest";
import { OPEN_ALL_MAX, defaultOpen, heatmapModel } from "../../src/domain/heatmap";
import { PILLARS } from "../../src/domain/types";
import { rowOf, fixtureRows } from "./rows";

const many = (dom: string, n: number) => Array.from({ length: n }, (_, i) => rowOf({ id: dom + i, name: dom + i, domain: dom }));

describe("heatmapModel", () => {
  it("sorts groups by size, then name, and every app is in exactly one group", () => {
    const rows = fixtureRows();
    const m = heatmapModel(rows);
    expect(m.total).toBe(rows.length);
    expect(m.groups.reduce((s, g) => s + g.apps, 0)).toBe(rows.length);
    for (let i = 1; i < m.groups.length; i++) {
      const a = m.groups[i - 1]!, b = m.groups[i]!;
      expect(a.apps > b.apps || (a.apps === b.apps && a.name < b.name)).toBe(true);
    }
  });
  it("breaks size ties by name", () => {
    const m = heatmapModel([...many("B", 2), ...many("A", 2), ...many("C", 3)]);
    expect(m.groups.map((g) => g.name)).toEqual(["C", "A", "B"]);
  });
  it("segment counts are exact and sum to the group size", () => {
    const rows = fixtureRows();
    const m = heatmapModel(rows);
    for (const g of m.groups) for (const p of PILLARS) {
      const c = g.counts[p];
      expect(c.bad + c.warn + c.none + c.ok).toBe(g.apps);
      for (const s of ["bad", "warn", "none", "ok"] as const) {
        expect(c[s]).toBe(g.rows.filter((r) => r.status[p].status === s).length);
      }
    }
  });
  it("a blank domain is the NO DOMAIN group", () => {
    const m = heatmapModel([rowOf({ id: "x", domain: "  " })]);
    expect(m.groups[0]!.name).toBe("NO DOMAIN");
  });
  it("is empty for no rows", () => {
    expect(heatmapModel([])).toEqual({ total: 0, groups: [] });
    expect(defaultOpen(heatmapModel([]))).toEqual([]);
  });
});

describe("defaultOpen", () => {
  it("opens the largest group above the threshold", () => {
    const m = heatmapModel([...many("Big", OPEN_ALL_MAX), ...many("Small", 3)]);
    expect(defaultOpen(m)).toEqual(["Big"]);
  });
  it("opens every group at 40 applications or fewer", () => {
    const m = heatmapModel([...many("Big", OPEN_ALL_MAX - 5), ...many("Small", 5)]);
    expect(m.total).toBe(OPEN_ALL_MAX);
    expect(defaultOpen(m).sort()).toEqual(["Big", "Small"]);
  });
  it("opens a lone group however large", () => {
    expect(defaultOpen(heatmapModel(many("Only", 100)))).toEqual(["Only"]);
  });
});
