import { describe, expect, it } from "vitest";
import { __resetHeatmapForTest, barText, heatLens, heatTable, heatView, toggleGroup } from "../../src/client/pages/heatmap.js";
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
  it("cells carry the glyph, the word and the reason; names are escaped", () => {
    const h = s(heatTable(m, new Set(["D1", "D2"])));
    expect(h).toContain("hc ");
    expect(h).toContain('class="gl ');
    expect(h).not.toContain('class="dot ');
    expect(h).toMatch(/class="hc \w+" data-pillar="cyber"><span><span class="gl \w+" aria-hidden="true">/);
    expect(h).toContain('class="sr-only">Cyber: ');
    expect(h).not.toContain("<b>Beta</b>");
    expect(h).toContain("&lt;b&gt;Beta");
  });
  it("pillar column heads are in the pillar's colour class", () => {
    const h = s(heatTable(m, new Set()));
    for (const p of ["cyber", "compliance", "continuity", "platform"]) expect(h).toContain(`<th class="hp pc-${p}">`);
  });
  it("a group row has one stacked bar per pillar, OK then Attention then Gap then No data, no zero segments", () => {
    const g = { name: "G", apps: 12, rows: [], counts: Object.fromEntries(["cyber", "compliance", "continuity", "platform"].map((p) => [p, { ok: 5, warn: 3, bad: 3, none: 1 }])) };
    const h = s(heatTable({ total: 12, groups: [g] }, new Set()));
    const bars = [...h.matchAll(/<span class="sb" role="img"[^>]*>(.*?)<\/span>/g)].map((x) => x[1]);
    expect(bars).toHaveLength(4);
    for (const b of bars) expect([...b.matchAll(/<i class="(\w+)" style="flex:(\d+)">/g)].map((x) => x[1] + x[2])).toEqual(["ok5", "warn3", "bad3", "none1"]);
    const zero = { ...g, counts: { ...g.counts, cyber: { ok: 12, warn: 0, bad: 0, none: 0 } } };
    expect(s(heatTable({ total: 12, groups: [zero] }, new Set()))).toMatch(/Cyber: 0 gaps · 0 need attention · 0 no data · 12 OK"><i class="ok" style="flex:12"><\/i><\/span>/);
  });
  it("the bar says its numbers in words, in the tip and the accessible name", () => {
    const h = s(heatTable(m, new Set()));
    expect(h).toContain('data-tip="Cyber: ');
    expect(h).toContain('aria-label="Cyber: ');
  });
  it("the group row says how many applications it holds", () => {
    expect(s(heatTable(m, new Set()))).toContain("2 apps");
  });
  it("the lens keeps the open groups across redraws and a toggle opens or closes one", () => {
    __resetHeatmapForTest();
    const many = Array.from({ length: 45 }, (_, i) => rowOf({ id: "m" + i, name: "N" + i, domain: i < 30 ? "BIG" : "SMALL" }));
    const open = (h) => [...s(h).matchAll(/data-grp="(\w+)"[^>]*aria-expanded="(\w+)"/g)].map((x) => x[1] + ":" + x[2]);
    expect(open(heatLens(many, 45))).toEqual(["BIG:true", "SMALL:false"]);
    toggleGroup(many, "SMALL");
    expect(open(heatLens(many, 45))).toEqual(["BIG:true", "SMALL:true"]);
    toggleGroup(many, "BIG");
    expect(open(heatLens(many, 45))).toEqual(["BIG:false", "SMALL:true"]);
    __resetHeatmapForTest();
  });
  it("bar text is exact", () => {
    expect(barText({ bad: 1, warn: 2, none: 0, ok: 3 })).toBe("1 gap · 2 need attention · 0 no data · 3 OK");
  });
  it("the empty register shows the empty state", () => {
    expect(s(heatView(heatmapModel([]), new Set(), 5))).toContain("empty");
  });
});
