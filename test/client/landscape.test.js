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
  const h = s(landscapeView(landscapeModel(rows, "tier"), 3, 0));
  it("renders a named button per application, with no title attribute", () => {
    expect((h.match(/<button type="button" class="tl /g) || []).length).toBe(3);
    expect(h).toContain(">Alpha</button>");
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
  it("the metric switch marks the current metric and the legend follows it", () => {
    expect(s(metricSwitch("c2"))).toContain('data-v="c2" data-k="metric-c2" aria-pressed="true"');
    expect(s(metricSwitch("c2"))).toContain('data-v="worst" data-k="metric-worst" aria-pressed="false"');
    expect(s(legendView("tier"))).toContain("No tier");
    expect(s(legendView("q"))).toContain("80% or more");
    expect(s(legendView("worst"))).toContain("Needs attention");
  });
  it("the empty register shows the empty state", () => {
    expect(s(landscapeView(landscapeModel([], "worst"), 5, 0))).toContain("empty");
  });
});
