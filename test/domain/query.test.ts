import { describe, expect, it } from "vitest";
import { FACETS, facetValues, facetValuesOf, fold } from "../../src/domain/facets";
import { facetCounts, filterRows, matchRow, runQuery, sortRows } from "../../src/domain/query";
import { statusKey } from "../../src/domain/columns";
import { fixtureRows, rowOf } from "./rows";

const rows = fixtureRows();

describe("filters", () => {
  it("ORs within a facet and ANDs across facets", () => {
    const a = filterRows(rows, { q: "", f: { tier: ["T1"] } });
    const b = filterRows(rows, { q: "", f: { tier: ["T2"] } });
    const ab = filterRows(rows, { q: "", f: { tier: ["T1", "T2"] } });
    expect(ab.length).toBe(a.length + b.length);
    const doms = facetValues(rows, "dom");
    const both = filterRows(rows, { q: "", f: { tier: ["T1", "T2"], dom: [doms[0]!] } });
    for (const r of both) {
      expect(["T1", "T2"]).toContain(facetValuesOf(r, "tier")[0]);
      expect(r.app.domain).toBe(doms[0]);
    }
    expect(both.length).toBeLessThanOrEqual(ab.length);
  });

  it("matches the filter row by row with brute force", () => {
    const f = { tier: ["T1", "No tier"], gap: ["Cyber"] };
    const got = filterRows(rows, { q: "", f }).map((r) => r.app.id);
    const want = rows.filter((r) => {
      const t = r.app.tier ? "T" + r.app.tier : "No tier";
      return (t === "T1" || t === "No tier") && r.status.cyber.status === "bad";
    }).map((r) => r.app.id);
    expect(got).toEqual(want);
  });

  it("facetCounts skip their own facet but honour the others", () => {
    const f = { tier: ["T1"], dom: [facetValues(rows, "dom")[0]!] };
    const tierCounts = facetCounts(rows, { q: "", f }, "tier");
    const expectT = new Map<string, number>();
    for (const r of rows) if (r.app.domain === f.dom[0]) { const t = facetValuesOf(r, "tier")[0]!; expectT.set(t, (expectT.get(t) || 0) + 1); }
    expect(tierCounts).toEqual(expectT);
    // The other facet still sees the tier selection.
    const domCounts = facetCounts(rows, { q: "", f }, "dom");
    let total = 0;
    for (const n of domCounts.values()) total += n;
    expect(total).toBe(rows.filter((r) => r.app.tier === 1).length);
  });

  it("counts a multi-gap app under each pillar", () => {
    const r = rowOf({ securityOfficer: null, tier: 1, exposed: true });
    const vals = facetValuesOf(r, "gap");
    expect(vals).toContain("Cyber");
    const counts = facetCounts([r], { q: "", f: {} }, "gap");
    for (const v of vals) expect(counts.get(v)).toBe(1);
  });

  it("searches the seven fields, ignoring case and accents", () => {
    const fields = ["name", "domain", "subdomain", "supportGroup", "owner", "backupOwner", "securityOfficer"] as const;
    for (const f of fields) {
      const r = rowOf({ [f]: "Zoé Élodie Ünal" } as never);
      expect(matchRow(r, { q: "zoe elodie unal", f: {} })).toBe(true);
      expect(matchRow(r, { q: "ZOÉ", f: {} })).toBe(true);
      expect(matchRow(r, { q: "nobody", f: {} })).toBe(false);
    }
    expect(matchRow(rowOf({ hosting: "Zoé", typology: "Zoé" }), { q: "zoe", f: {} })).toBe(false);
    expect(fold("Éa")).toBe("ea");
  });
});

describe("facets", () => {
  it("orders tiers T1..T4 then No tier and keeps None assigned last", () => {
    const rs = [rowOf({ tier: null }), rowOf({ tier: 3 }), rowOf({ tier: 1 }), rowOf({ tier: 4 }), rowOf({ tier: 2 }),
      rowOf({ securityOfficer: null }), rowOf({ securityOfficer: "Zed" }), rowOf({ securityOfficer: "Abe" })];
    expect(facetValues(rs, "tier")).toEqual(["T1", "T2", "T3", "T4", "No tier"]);
    expect(facetValues(rs, "so")).toEqual(["Abe", "Zed", "None assigned"]);
  });

  it("buckets blanks and defines gap as a bad pillar status", () => {
    const r = rowOf({});
    expect(facetValuesOf(r, "sd")).toEqual(["No subdomain"]);
    expect(facetValuesOf(r, "lc")).toEqual(["Not set"]);
    expect(facetValuesOf(rowOf({ lifecycle: "END_OF_LIFE" }), "lc")).toEqual(["End of life"]);
    const g = rowOf({ securityOfficer: null });
    expect(facetValuesOf(g, "gap")).toContain("Cyber");
    for (const x of rows) {
      const want = (["cyber", "compliance", "continuity", "platform"] as const).filter((p) => x.status[p].status === "bad").length;
      expect(facetValuesOf(x, "gap")).toHaveLength(want);
    }
    expect(FACETS.map((f) => f.key)).toEqual(["dom", "sd", "tier", "lc", "so", "gap", "ty", "h"]);
  });
});

describe("sortRows", () => {
  it("breaks ties by name, in both directions", () => {
    const rs = ["b", "a", "c"].map((n) => rowOf({ name: n, id: n, tier: 2 }));
    expect(sortRows(rs, "t", false).map((r) => r.app.name)).toEqual(["a", "b", "c"]);
    expect(sortRows(rs, "t", true).map((r) => r.app.name)).toEqual(["a", "b", "c"]);
  });

  it("sinks unknowns last in both directions", () => {
    const rs = [rowOf({ name: "n", id: "n", tier: null }), rowOf({ name: "x", id: "x", tier: 1 }), rowOf({ name: "y", id: "y", tier: 3 })];
    expect(sortRows(rs, "t", false).map((r) => r.app.name)).toEqual(["x", "y", "n"]);
    expect(sortRows(rs, "t", true).map((r) => r.app.name)).toEqual(["y", "x", "n"]);
    const so = [rowOf({ name: "n", id: "n" }), rowOf({ name: "a", id: "a", securityOfficer: "Q" })];
    expect(sortRows(so, "so", false)[1]!.app.name).toBe("n");
    expect(sortRows(so, "so", true)[1]!.app.name).toBe("n");
  });

  it("status key is bad*100 + warn*10", () => {
    for (const r of rows) {
      const ps = [r.status.cyber, r.status.compliance, r.status.continuity, r.status.platform].map((p) => p.status);
      expect(statusKey(r)).toBe(ps.filter((s) => s === "bad").length * 100 + ps.filter((s) => s === "warn").length * 10);
    }
    const sorted = sortRows(rows, "st", true);
    for (let i = 1; i < sorted.length; i++) expect(statusKey(sorted[i - 1]!)).toBeGreaterThanOrEqual(statusKey(sorted[i]!));
  });

  it("does not mutate the input and falls back to name for an unknown key", () => {
    const copy = rows.slice();
    sortRows(rows, "nope", false);
    expect(rows).toEqual(copy);
    const names = sortRows(rows, "nope", false).map((r) => r.app.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("runQuery filters then sorts", () => {
    const out = runQuery(rows, { q: "", f: { tier: ["T1"] }, sort: "n", desc: true });
    expect(out.every((r) => r.app.tier === 1)).toBe(true);
    const names = out.map((r) => r.app.name.toLowerCase());
    expect(names).toEqual([...names].sort().reverse());
  });
});
