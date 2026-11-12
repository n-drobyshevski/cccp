import { describe, expect, it } from "vitest";
import { overviewModel, TOP_DOMAINS } from "../../src/domain/overview";
import { filterRows } from "../../src/domain/query";
import { facetValues } from "../../src/domain/facets";
import { fixtureRows } from "./rows";

const rows = fixtureRows();
const m = overviewModel(rows);
const n = (f: object) => filterRows(rows, { q: "", f }).length;

describe("overview model", () => {
  it("has 4 KPIs with value, denominator and target", () => {
    expect(m.kpis.map((k) => k.id)).toEqual(["gap", "t1gap", "noso", "eol"]);
    for (const k of m.kpis) {
      expect(k.value).toBeLessThanOrEqual(k.denominator);
      expect(Object.keys(k.target).length).toBeGreaterThan(0);
      expect(k.pct).toBe(k.denominator ? Math.round((k.value / k.denominator) * 100) : 0);
    }
    expect(m.kpis[0]!.denominator).toBe(rows.length);
  });

  it("every target reproduces its number through query", () => {
    for (const k of m.kpis) {
      expect(n(k.target)).toBe(k.value);
      expect(n(k.denominatorTarget)).toBe(k.denominator);
    }
    for (const p of m.pillars) expect(n(p.target)).toBe(p.counts.bad);
    for (const d of m.domains) {
      expect(n(d.target)).toBe(d.apps);
      expect(n(d.gapTarget)).toBe(d.gaps);
    }
  });

  it("matches brute force counts", () => {
    const any = rows.filter((r) => Object.values(r.status).some((s) => s.status === "bad")).length;
    expect(m.kpis[0]!.value).toBe(any);
    expect(m.kpis[2]!.value).toBe(rows.filter((r) => !r.app.securityOfficer || !r.app.securityOfficer.trim()).length);
  });

  it("pillar counts sum to the total", () => {
    expect(m.pillars.map((p) => p.pillar)).toEqual(["cyber", "compliance", "continuity", "platform"]);
    for (const p of m.pillars) {
      expect(p.counts.bad + p.counts.warn + p.counts.none + p.counts.ok).toBe(m.total);
      expect(p.total).toBe(rows.length);
    }
  });

  it("lists the top 8 domains by gaps, with completeness", () => {
    const all = facetValues(rows, "dom").length;
    expect(m.domains.length).toBe(Math.min(TOP_DOMAINS, all));
    for (let i = 1; i < m.domains.length; i++) expect(m.domains[i - 1]!.gaps).toBeGreaterThanOrEqual(m.domains[i]!.gaps);
    for (const d of m.domains) {
      expect(d.completeness).toBeGreaterThanOrEqual(0);
      expect(d.completeness).toBeLessThanOrEqual(100);
    }
  });

  it("an empty register gives zeros, not NaN", () => {
    const e = overviewModel([]);
    expect(e.total).toBe(0);
    expect(e.kpis.every((k) => k.value === 0 && k.pct === 0)).toBe(true);
    expect(e.domains).toEqual([]);
  });
});
