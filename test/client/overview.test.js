import { describe, expect, it } from "vitest";
import { kpiTile } from "../../src/client/components/kpiTile.js";
import { stackBar } from "../../src/client/components/stackBar.js";
import { overviewView } from "../../src/client/pages/overview.js";
import { overviewModel } from "../../src/domain/overview";
import { fixtureRows } from "../domain/rows";

const m = overviewModel(fixtureRows());
const s = (v) => String(v);

describe("overview views", () => {
  it("a bar has a tip per segment and sr-only counts", () => {
    const h = s(stackBar({ bad: 2, warn: 1, none: 0, ok: 5 }));
    expect(h).toContain('data-tip="2 gaps"');
    expect(h).toContain('data-tip="5 OK"');
    expect(h).not.toContain("0 no data");
    expect(h).toContain('class="sr-only"');
    expect(h).toContain("1 needs attention");
  });
  it("a tile carries its target", () => {
    const h = s(kpiTile(m.kpis[1]));
    expect(h).toContain("data-go=");
    expect(h).toContain("Tier 1 with a gap");
  });
  it("the page draws 4 tiles, 4 pillar bars and the domains", () => {
    const h = s(overviewView(m, 0, ""));
    expect((h.match(/class="kpi /g) || []).length).toBe(4);
    expect((h.match(/class="pbar"/g) || []).length).toBe(4);
    expect(h).toContain("Domains with the most gaps");
  });
  it("escapes hostile domain names", () => {
    const bad = { ...m, domains: [{ name: "<img src=x onerror=1>", apps: 1, gaps: 0, completeness: 50, target: { dom: ["x"] }, gapTarget: {} }] };
    expect(s(overviewView(bad, 0, ""))).not.toContain("<img");
  });
});
