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
    expect((h.match(/class="pbar pc-/g) || []).length).toBe(4);
    expect(h).toContain("Domains with the most gaps");
  });
  it("the title line says the count and when the data was read", () => {
    expect(s(overviewView(m, 0, "12 Nov 2026, 09:42"))).toContain("· read 12 Nov 2026, 09:42");
    expect(s(overviewView(m, 3, ""))).toContain("3 applications hidden by the display settings");
  });
  it("every figure says where it goes: 'Open in inventory'", () => {
    const h = s(overviewView(m, 0, ""));
    expect((h.match(/Open in inventory ›/g) || []).length).toBe(4);
    expect(s(kpiTile(m.kpis[0]))).toContain('class="num mono" data-value');
  });
  it("the bars stack OK, Attention, Gap, No data, and the gap count is mono", () => {
    const h = s(stackBar({ bad: 2, warn: 1, none: 3, ok: 5 }));
    expect([...h.matchAll(/<i class="(\w+)" style/g)].map((x) => x[1])).toEqual(["ok", "warn", "bad", "none"]);
    expect(s(overviewView(m, 0, ""))).toMatch(/<b class="mono">\d+<\/b> gaps?/);
  });
  it("the domains table has Apps, With a gap and a glyph column per pillar, no Completeness", () => {
    const h = s(overviewView(m, 0, ""));
    const head = h.slice(h.indexOf("<thead>"), h.indexOf("</thead>"));
    expect(head).toContain("Apps");
    expect(head).toContain("With a gap");
    expect(head).not.toContain("Completeness");
    for (const p of ["cyber", "compliance", "continuity", "platform"]) expect(head).toContain(`pc-${p}`);
    const row = h.slice(h.indexOf("<tbody>"), h.indexOf("</tr>", h.indexOf("<tbody>")));
    expect((row.match(/class="gl /g) || []).length).toBe(4);
    expect(row).toMatch(/Cyber: (Gap|Needs attention|OK|No data)/);
  });
  it("each domain's glyph is the worst status among its applications", () => {
    for (const d of m.domains) for (const p of ["cyber", "compliance", "continuity", "platform"]) {
      const rs = fixtureRows().filter((r) => (r.app.domain || "").trim() === d.name || (!r.app.domain && d.name === "NO DOMAIN"));
      const order = ["bad", "warn", "none", "ok"];
      const want = order.find((x) => rs.some((r) => r.status[p].status === x)) || "ok";
      expect(d.worst[p]).toBe(want);
    }
  });
  it("escapes hostile domain names", () => {
    const bad = { ...m, domains: [{ name: "<img src=x onerror=1>", apps: 1, gaps: 0, completeness: 50, worst: { cyber: "bad", compliance: "ok", continuity: "none", platform: "warn" }, target: { dom: ["x"] }, gapTarget: {} }] };
    expect(s(overviewView(bad, 0, ""))).not.toContain("<img");
  });
});
