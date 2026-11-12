import { describe, expect, it } from "vitest";
import { landscapeView, legendView, metricSwitch } from "../../src/client/pages/landscape.js";
import { landscapeModel } from "../../src/domain/landscape";
import { rowOf } from "../domain/rows";

const s = (v) => String(v);
const rows = [
  rowOf({ id: "a", name: "Alpha", domain: "D1", subdomain: "S", tier: 1 }),
  rowOf({ id: "b", name: "<b>Beta</b>", domain: "D1", subdomain: null }),
  rowOf({ id: "c", name: "Gamma", domain: "D2", subdomain: "S" }),
];

describe("landscape view", () => {
  const h = s(landscapeView(landscapeModel(rows, "tier"), 3));
  it("renders a named button per application, with no title attribute", () => {
    expect((h.match(/<button type="button" class="tl /g) || []).length).toBe(3);
    expect(h).toContain("<span>Alpha</span></button>");
    expect(h).not.toMatch(/\btitle=/);
    expect(h).toContain('data-tip="Alpha · Tier: T1"');
    expect(h).toContain('aria-label="Alpha · Tier: T1"');
  });
  it("escapes names", () => {
    expect(h).not.toContain("<b>Beta</b>");
    expect(h).toContain("&lt;b&gt;Beta");
  });
  it("groups a blank subdomain as Other", () => {
    expect(h).toContain("<span>Other</span>");
  });
  it("unknown values are the hatched tone", () => {
    expect(h).toContain("tl ls-none");
    expect(h).toContain("ls-t1");
  });
  it("a tile has a small status square, dashed (ls-none) when the value is unknown", () => {
    expect(h).toMatch(/class="tl ls-t1"[^>]*><i class="sq" aria-hidden="true"><\/i><span>Alpha<\/span>/);
    expect(h).toMatch(/class="tl ls-none"[^>]*><i class="sq"/);
  });
  it("a Gap tile is a bad tone, so it gets the red-tinted border", () => {
    const bad = rowOf({ id: "z", name: "Zed", domain: "D1", securityOfficer: null, tier: 1 });
    const out = s(landscapeView(landscapeModel([bad], "worst"), 1));
    expect(out).toContain('class="tl ls-bad"');
  });
  it("the pillar choices of the switch carry their pillar's colour class, Worst and Tier do not", () => {
    const sw = s(metricSwitch("worst"));
    for (const [k, p] of [["c0", "cyber"], ["c1", "compliance"], ["c2", "continuity"], ["c3", "platform"]]) expect(sw).toContain(`<button type="button" class="pc-${p}" data-act="metric" data-v="${k}"`);
    expect(sw).toContain('<button type="button" data-act="metric" data-v="worst"');
    expect(sw).toContain('<button type="button" data-act="metric" data-v="tier"');
  });
  it("the legend sits next to the switch and the domains carry their count", () => {
    expect(h).toMatch(/class="lctl">.*class="metric".*class="lgd"/);
    expect(h).toMatch(/<section class="dbox" data-domain="D1"><header><b>D1<\/b><small class="mono">2<\/small>/);
  });
  it("the metric switch marks the current metric and the legend follows it", () => {
    expect(s(metricSwitch("c2"))).toContain('data-v="c2" data-k="metric-c2" aria-pressed="true"');
    expect(s(metricSwitch("c2"))).toContain('data-v="worst" data-k="metric-worst" aria-pressed="false"');
    expect(s(legendView("tier"))).toContain("No tier");
    expect(s(legendView("q"))).toContain("80% or more");
    expect(s(legendView("worst"))).toContain("Needs attention");
  });
  it("the empty register shows the empty state", () => {
    expect(s(landscapeView(landscapeModel([], "worst"), 5))).toContain("empty");
  });
});
