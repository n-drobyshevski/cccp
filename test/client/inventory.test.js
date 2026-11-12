// The Inventory's new parts as pure views and controllers: the pillar tabs and their counts, the
// left facet panel (top N, "+ N more", Clear, selected values kept) and the filters drawer button.
// DOM behaviour is in e2e/inventory.spec.ts.
import { describe, expect, it } from "vitest";
import { TOP_N, facetPanelView, ranked, visibleOptions } from "../../src/client/components/facetPanel.js";
import { activeTags, headView, pillarTabsView } from "../../src/client/pages/list.js";
import * as register from "../../src/client/state/register.js";
import { initialState } from "../../src/client/state/store.js";
import { facetOptions } from "../../src/domain/query";
import { DEFAULT_RULES } from "../../src/domain/rules";
import { mk } from "../domain/mk";

const today = "2026-11-11";
const display = { opensOn: "list", theme: "system", hidePrefix: "", hideEol: false };
const doms = ["A", "A", "A", "B", "B", "C", "D", "E", "F", "G", "H"];
const apps = doms.map((d, i) => mk({ id: "x" + i, name: "App " + i, domain: d, tier: (i % 4) + 1, securityOfficer: i % 2 ? "Ann" : null }));
const rows = register.derive(apps, { rules: DEFAULT_RULES, display, today }).rows;
const state = (over) => ({ ...initialState(), route: "list", ...over });
const s = (v) => String(v);

describe("pillar tabs", () => {
  it("draws All and the four pillars as tabs, each with its count", () => {
    const h = s(pillarTabsView(state(), rows));
    expect([...h.matchAll(/data-act="ptab" data-tab="(\w+)"/g)].map((m) => m[1])).toEqual(["all", "cyber", "compliance", "continuity", "platform"]);
    expect(h).toContain('role="tablist"');
    expect(h).toContain(" shown<");
    expect(h).toContain('aria-selected="true"');
  });
  it("counts gaps over the filtered set", () => {
    const st = state({ f: { dom: ["A"] } });
    const h = s(pillarTabsView(st, rows));
    const all = Number(/data-tab="all"[^>]*>.*?<b class="num mono">(\d+)</.exec(h)[1]);
    expect(all).toBe(3);
    const cyber = rows.filter((r) => r.app.domain === "A" && r.status.cyber.status === "bad").length;
    expect(Number(/data-tab="cyber"[^>]*>.*?<b class="num mono">(\d+)</.exec(h)[1])).toBe(cyber);
  });
  it("the tab on is the Gap in selection: one pillar is its tab, none is All, several is no tab", () => {
    const sel = (f) => /data-tab="(\w+)"/.exec(s(pillarTabsView(state({ f }), rows)).split('aria-selected="true"')[1] || "")?.[1] ?? null;
    expect(sel({})).toBe("all");
    expect(sel({ gap: ["Cyber"] })).toBe("cyber");
    expect(sel({ gap: ["Platform"] })).toBe("platform");
    expect(sel({ gap: ["Cyber", "Platform"] })).toBeNull();
  });
  it("only the open tab is in the Tab order", () => {
    const h = s(pillarTabsView(state({ f: { gap: ["Cyber"] } }), rows));
    expect(h.match(/tabindex="0"/g)).toHaveLength(1);
  });
});

describe("facet panel", () => {
  const st = { open: new Set(), finds: {} };
  it("lists the facets with their counts and checkboxes", () => {
    const h = s(facetPanelView(state(), rows, st));
    for (const k of ["tier", "lc", "dom", "so", "gap"]) expect(h).toContain('data-facet="' + k + '"');
    expect(h).toContain('type="checkbox"');
    expect(h).toContain(">Tier<");
  });
  it("shows the top N values by count and a '+ N more' expander for a long facet", () => {
    const opts = facetOptions(rows, { q: "", f: {} }, "dom");
    expect(opts.length).toBe(8);
    const v = visibleOptions(opts, "dom", false);
    expect(v.shown.length).toBe(TOP_N);
    expect(v.hidden).toBe(3);
    expect(v.shown[0].value).toBe("A");
    const h = s(facetPanelView(state(), rows, st));
    expect(h).toContain("+ 3 more");
    expect(visibleOptions(opts, "dom", true).hidden).toBe(0);
    const open = s(facetPanelView(state(), rows, { open: new Set(["dom"]), finds: {} }));
    expect(open).toContain("Show fewer");
    expect(open).toContain('data-find="dom"');
  });
  it("keeps a selected value visible even when it ranks below the cut, and offers Clear", () => {
    const h = s(facetPanelView(state({ f: { dom: ["H"] } }), rows, st));
    expect(h).toContain('data-v="H"');
    expect(h).toMatch(/data-act="clear-facet" data-facet="dom"/);
    expect(s(facetPanelView(state(), rows, st))).not.toContain('data-act="clear-facet" data-facet="dom"');
  });
  it("keeps a fixed order for tier and ranks the others by count", () => {
    const opts = facetOptions(rows, { q: "", f: {} }, "tier");
    expect(ranked(opts, "tier")).toBe(opts);
    expect(ranked(facetOptions(rows, { q: "", f: {} }, "dom"), "dom").map((o) => o.count)).toEqual([3, 2, 1, 1, 1, 1, 1, 1]);
  });
});

describe("filters drawer button and tags", () => {
  it("the head carries a Filters button with the number of selected values", () => {
    expect(s(headView(state(), 5, 5, 0))).toContain(">Filters<");
    expect(s(headView(state({ f: { tier: ["T1"], dom: ["A"] } }), 5, 5, 0))).toContain(">Filters (2)<");
    expect(s(headView(state(), 5, 5, 0))).toContain('aria-haspopup="dialog" aria-expanded="false"');
  });
  it("tags are one per facet with a selection, plus the search", () => {
    expect(activeTags(state({ q: " x ", f: { tier: ["T1"] } })).map((t) => t.key)).toEqual(["q", "tier"]);
    expect(activeTags(state())).toEqual([]);
  });
});
