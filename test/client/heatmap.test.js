import { describe, expect, it } from "vitest";
import { barText, heatTable, heatView } from "../../src/client/pages/heatmap.js";
import { heatmapModel } from "../../src/domain/heatmap";
import { rowOf } from "../domain/rows";

const s = (v) => String(v);
const rows = [
  rowOf({ id: "a", name: "Alpha", domain: "D1", tier: 1 }),
  rowOf({ id: "b", name: "<b>Beta</b>", domain: "D1" }),
  rowOf({ id: "c", name: "Gamma", domain: "D2" }),
];
const m = heatmapModel(rows);

describe("heatmap view", () => {
  it("draws a row per open group's app and none for a closed one", () => {
    const h = s(heatTable(m, new Set(["D1"])));
    expect((h.match(/<tr data-id=/g) || []).length).toBe(2);
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('aria-expanded="false"');
  });
  it("the red number is the bad count", () => {
    const h = s(heatTable(m, new Set()));
    for (const g of m.groups) for (const p of ["cyber", "compliance", "continuity", "platform"]) {
      const bad = g.counts[p].bad;
      expect(h).toContain(`<small data-bad="${p}" class="${bad ? "bad" : ""}">${bad || ""}</small>`);
    }
  });
  it("cells carry the dot, the word and the reason; names are escaped", () => {
    const h = s(heatTable(m, new Set(["D1", "D2"])));
    expect(h).toContain("hc ");
    expect(h).toContain('class="dot ');
    expect(h).not.toContain("<b>Beta</b>");
    expect(h).toContain("&lt;b&gt;Beta");
  });
  it("bar text is exact", () => {
    expect(barText({ bad: 1, warn: 2, none: 0, ok: 3 })).toBe("1 gap · 2 need attention · 0 no data · 3 OK");
  });
  it("the empty register shows the empty state", () => {
    expect(s(heatView(heatmapModel([]), new Set(), 5, 0))).toContain("empty");
  });
});
