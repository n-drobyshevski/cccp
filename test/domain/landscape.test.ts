import { describe, expect, it } from "vitest";
import { LANDSCAPE_METRICS, OTHER_GROUP, landscapeModel, legendFor, toneOf } from "../../src/domain/landscape";
import { METRICS } from "../../src/domain/viewState";
import { qualityLevel } from "../../src/domain/quality";
import { rowOf, fixtureRows } from "./rows";

const app = (id: string, name: string, domain: string, subdomain: string | null, extra = {}) => rowOf({ id, name, domain, subdomain, ...extra });

describe("landscapeModel", () => {
  it("orders domains and groups by size then name, and tiles by name", () => {
    const m = landscapeModel([
      app("1", "b", "B", "s"), app("2", "a", "B", "s"), app("3", "c", "B", "t"),
      app("4", "z", "A", "s"), app("5", "y", "A", "s"), app("6", "x", "C", "s"),
      app("7", "w", "C", "s"), app("8", "v", "C", "s"),
    ], "worst");
    expect(m.domains.map((d) => d.name)).toEqual(["B", "C", "A"]);
    const b = m.domains[0]!;
    expect(b.groups.map((g) => g.name)).toEqual(["s", "t"]);
    expect(b.groups[0]!.tiles.map((t) => t.name)).toEqual(["a", "b"]);
    expect(m.domains[2]!.groups[0]!.tiles.map((t) => t.name)).toEqual(["y", "z"]);
  });
  it("sizes tie-break by name", () => {
    const m = landscapeModel([app("1", "a", "Y", "s"), app("2", "b", "X", "s")], "worst");
    expect(m.domains.map((d) => d.name)).toEqual(["X", "Y"]);
  });
  it("blank and missing subdomains group as Other", () => {
    const m = landscapeModel([app("1", "a", "D", null), app("2", "b", "D", "  "), app("3", "c", "D", "Real")], "worst");
    const g = m.domains[0]!.groups;
    expect(g.map((x) => [x.name, x.apps])).toEqual([[OTHER_GROUP, 2], ["Real", 1]]);
  });
  it("every application is exactly one tile and counts add up", () => {
    const rows = fixtureRows();
    const m = landscapeModel(rows, "worst");
    expect(m.total).toBe(rows.length);
    const ids = m.domains.flatMap((d) => d.groups.flatMap((g) => g.tiles.map((t) => t.id)));
    expect(ids.length).toBe(rows.length);
    expect(new Set(ids).size).toBe(rows.length);
    for (const d of m.domains) expect(d.apps).toBe(d.groups.reduce((n, g) => n + g.apps, 0));
  });
  it("is empty for no rows", () => {
    expect(landscapeModel([], "worst")).toEqual({ total: 0, metric: "worst", domains: [] });
  });
  it("an unknown metric falls back to worst", () => {
    expect(landscapeModel([], "nope").metric).toBe("worst");
  });
});

describe("tones", () => {
  it("worst and pillar metrics follow the status, none is the unknown tone", () => {
    for (const r of fixtureRows()) {
      expect(toneOf(r, "worst").tone).toBe(r.status.worst);
      expect(toneOf(r, "c0").tone).toBe(r.status.cyber.status);
      expect(toneOf(r, "c1").tone).toBe(r.status.compliance.status);
      expect(toneOf(r, "c2").tone).toBe(r.status.continuity.status);
      expect(toneOf(r, "c3").tone).toBe(r.status.platform.status);
    }
  });
  it("tier maps T1-T4 to a ramp and no tier to none", () => {
    for (const t of [1, 2, 3, 4] as const) expect(toneOf(rowOf({ tier: t }), "tier")).toEqual({ tone: "t" + t, value: "T" + t });
    expect(toneOf(rowOf({ tier: null }), "tier")).toEqual({ tone: "none", value: "none" });
  });
  it("completeness is bad under 50, warn under 80, else ok", () => {
    for (const r of fixtureRows()) {
      const t = toneOf(r, "q");
      expect(t.tone).toBe(qualityLevel(r.pct));
      expect(t.value).toBe(r.pct + "%");
    }
    expect(qualityLevel(49)).toBe("bad");
    expect(qualityLevel(50)).toBe("warn");
    expect(qualityLevel(80)).toBe("ok");
  });
  it("a tile tip names the application, the metric and the value", () => {
    const m = landscapeModel([app("1", "Alpha", "D", "S", { tier: 2 })], "tier");
    expect(m.domains[0]!.groups[0]!.tiles[0]).toMatchObject({ tone: "t2", tip: "Alpha · Tier: T2" });
    const c = landscapeModel([app("1", "Alpha", "D", "S")], "c1");
    expect(c.domains[0]!.groups[0]!.tiles[0]!.tip).toMatch(/^Alpha · Compliance: /);
  });
});

describe("metrics and legend", () => {
  it("the metric keys are the ones a URL and a saved view accept", () => {
    expect(LANDSCAPE_METRICS.map((m) => m.key)).toEqual([...METRICS]);
  });
  it("the legend follows the metric and always has a hatched unknown only where values can be unknown", () => {
    expect(legendFor("worst").map((l) => l.label)).toEqual(["OK", "Needs attention", "Gap", "No data"]);
    expect(legendFor("tier").map((l) => l.label)).toEqual(["T1", "T2", "T3", "T4", "No tier"]);
    expect(legendFor("q").map((l) => l.label)).toEqual(["80% or more", "50–79%", "Under 50%"]);
    for (const k of ["worst", "c0", "c1", "c2", "c3", "tier"]) expect(legendFor(k).some((l) => l.tone === "none")).toBe(true);
  });
});
