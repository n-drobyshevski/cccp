// The Inventory's facet panel and the checklists it shares with every list of facet values, as pure
// views: skip-semantics counts, muted zero rows, ranking and "+ n more", find, the tier list, the
// active-filter tags and the escaping of hostile values. The DOM behaviour (selection, drawer,
// keyboard, tips, one-row and no-overflow checks) is in e2e/filters.spec.ts and e2e/toolbar.spec.ts.
import { describe, expect, it } from "vitest";
import { checklist, findOptions } from "../../src/client/components/facetList.js";
import { PANEL_FACETS, TOP_N, facetPanelView, toggled, visibleOptions, withFacet } from "../../src/client/components/facetPanel.js";
import { activeTags, headView } from "../../src/client/pages/list.js";
import * as register from "../../src/client/state/register.js";
import { initialState } from "../../src/client/state/store.js";
import { facetOptions } from "../../src/domain/query";
import { DEFAULT_RULES } from "../../src/domain/rules";
import { mk } from "../domain/mk";

const today = "2026-11-11";
const display = { opensOn: "list", theme: "system", hidePrefix: "", hideEol: false };
const BAD = '<img src=x onerror=alert(1)>';
const apps = [
  mk({ id: "a", name: "Alpha", domain: "NORTH", securityOfficer: "Zoé Martin", lifecycle: "PRODUCTION", tier: 1 }),
  mk({ id: "b", name: "Beta", domain: "NORTH", securityOfficer: null, lifecycle: "END_OF_LIFE", tier: 2 }),
  mk({ id: "c", name: "Gamma", domain: "SOUTH", securityOfficer: "Zoe Moreau", lifecycle: "PRODUCTION", tier: 1 }),
  mk({ id: "d", name: "Delta", domain: BAD, securityOfficer: BAD, lifecycle: null, tier: null }),
];
const rows = register.derive(apps, { rules: DEFAULT_RULES, display, today }).rows;
const state = (over) => ({ ...initialState(), ...over });
const s = (v) => String(v);

/** Every tag of a markup string as {name, attrs}: fails on a '<' that does not open a plain tag. */
function tags(markup) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g;
  let rest = markup.replace(re, (m, close, name, attrs) => {
    out.push({ name: name.toLowerCase(), attrs: [...attrs.replace(/="[^"]*"/g, "").matchAll(/\s+([\w:-]+)/g)].map((a) => a[1].toLowerCase()) });
    return "";
  });
  rest = rest.replace(/<!--.*?-->/g, "");
  if (rest.indexOf("<") >= 0) throw new Error("a stray '<' outside a tag: " + rest.slice(rest.indexOf("<"), rest.indexOf("<") + 40));
  return out;
}

describe("selection helpers", () => {
  it("toggles a value on and off, and drops an emptied facet", () => {
    const a = toggled({}, "dom", "NORTH", true);
    expect(a).toEqual({ dom: ["NORTH"] });
    expect(toggled(a, "dom", "NORTH", true)).toEqual({ dom: ["NORTH"] });
    expect(toggled(a, "dom", "SOUTH", true)).toEqual({ dom: ["NORTH", "SOUTH"] });
    expect(toggled(a, "dom", "NORTH", false)).toEqual({});
    expect(withFacet({ tier: ["T1"] }, "dom", [])).toEqual({ tier: ["T1"] });
  });
  it("does not mutate its input", () => {
    const f = { dom: ["A"] };
    toggled(f, "dom", "B", true);
    expect(f).toEqual({ dom: ["A"] });
  });
});

describe("counts follow the skip rule", () => {
  it("a facet's own selection does not change its own counts, other facets do", () => {
    const f = { dom: ["NORTH"], tier: ["T1"] };
    const dom = facetOptions(rows, { q: "", f }, "dom");
    const north = dom.find((o) => o.value === "NORTH");
    expect(north.selected).toBe(true);
    expect(north.count).toBe(1);
    expect(dom.find((o) => o.value === "SOUTH").count).toBe(1);
    const lc = facetOptions(rows, { q: "", f }, "lc");
    expect(lc.find((o) => o.value === "Production").count).toBe(1);
    expect(lc.find((o) => o.value === "End of life").count).toBe(0);
  });
  it("search narrows every facet's counts", () => {
    const so = facetOptions(rows, { q: "alpha", f: {} }, "so");
    expect(so.filter((o) => o.count > 0).map((o) => o.value)).toEqual(["Zoé Martin"]);
  });
  it("renders zero-count values as muted rows and keeps them listed", () => {
    const options = facetOptions(rows, { q: "", f: { tier: ["T2"] } }, "lc");
    const out = s(checklist({ key: "lc", options, find: "", scope: "side" }));
    expect(out).toContain('<label class="ck zero">');
    const zero = [...out.matchAll(/<label class="ck( zero)?">.*?<small>(\d+)<\/small>/g)].map((m) => [!!m[1], m[2]]);
    for (const [muted, n] of zero) expect(muted).toBe(n === "0");
    expect(zero.some(([muted]) => muted)).toBe(true);
    expect(zero.some(([muted]) => !muted)).toBe(true);
  });
  it("a gap row carries a bad dot", () => {
    const out = s(checklist({ key: "gap", options: [{ value: "Cyber", count: 2, selected: false }], find: "", scope: "side" }));
    expect(out).toContain('class="dot bad"');
  });
});

describe("find", () => {
  const opts = facetOptions(rows, { q: "", f: {} }, "so");
  it("folds case and accents", () => {
    expect(findOptions(opts, "zoe").map((o) => o.value)).toEqual(["Zoe Moreau", "Zoé Martin"]);
    expect(findOptions(opts, "ZOÉ M").map((o) => o.value)).toEqual(["Zoe Moreau", "Zoé Martin"]);
    expect(findOptions(opts, "moreau").map((o) => o.value)).toEqual(["Zoe Moreau"]);
    expect(findOptions(opts, "  ").length).toBe(opts.length);
  });
  it("says so when nothing matches", () => {
    expect(s(checklist({ key: "so", options: opts, find: "qqqq", scope: "side" }))).toContain("Nothing matches");
  });
});

describe("checkbox focus keys", () => {
  it("each checkbox has a stable data-k and the scrolling list keeps its position", () => {
    const options = [{ value: "NORTH", count: 1, selected: true }];
    const out = s(checklist({ key: "dom", options, find: "", scope: "side" }));
    expect(out).toContain('data-k="side-dom-NORTH"');
    expect(out).toContain("checked");
    expect(out).toContain('data-keep-scroll="side-dom"');
  });
});

describe("the tier list", () => {
  it("counts like the others and shows No tier with a dashed none dot", () => {
    const options = facetOptions(rows, { q: "", f: {} }, "tier");
    const out = s(checklist({ key: "tier", options, find: "", scope: "side" }));
    expect([...out.matchAll(/data-v="([^"]*)"/g)].map((m) => m[1])).toEqual(["T1", "T2", "No tier"]);
    expect(out).toMatch(/data-v="T1"[^>]*>.*?<small>2<\/small>/);
    expect(out).toMatch(/class="dot none".*<span>No tier<\/span><small>1<\/small>/);
    expect((out.match(/class="dot none"/g) || []).length).toBe(1);
  });
});

describe("the facet panel", () => {
  const st = { open: new Set(), finds: {} };
  it("lists a section per facet, in order, each with a heading", () => {
    const out = s(facetPanelView(state(), rows, st));
    const keys = [...out.matchAll(/<section class="fg" data-facet="(\w+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(PANEL_FACETS.filter((k) => keys.includes(k)));
    expect(keys).toContain("tier");
    expect(keys).toContain("dom");
  });
  it("Clear shows only on a facet with a selection", () => {
    const out = s(facetPanelView(state({ f: { dom: ["NORTH"] } }), rows, st));
    expect(out.match(/data-act="clear-facet"/g)).toHaveLength(1);
    expect(out).toContain('data-k="fclear-dom"');
  });
  it("shows the top values, keeps a selected one, and '+ n more' opens the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ value: "V" + i, count: 9 - i, selected: i === 8 }));
    const closed = visibleOptions(many, "dom", false);
    expect(closed.shown).toHaveLength(TOP_N + 1);
    expect(closed.shown.map((o) => o.value)).toContain("V8");
    expect(closed.hidden).toBe(3);
    expect(visibleOptions(many, "dom", true).shown).toHaveLength(9);
  });
  it("a find text narrows its own section only, and only when the section is open", () => {
    const open = { open: new Set(["so"]), finds: { so: "moreau" } };
    const out = s(facetPanelView(state(), rows, open));
    expect(out).toContain('value="moreau"');
    expect(out).not.toContain(">Zoé Martin<");
    expect(out).toContain("Zoe Moreau");
    expect(out).toContain("NORTH");
  });
});

describe("the active-filter tags", () => {
  it("one per facet with a selection, and the search text", () => {
    const tg = activeTags(state({ q: " pay ", f: { dom: ["A", "B"], tier: ["T1"] } }));
    expect(tg.map((t) => t.key)).toEqual(["q", "dom", "tier"]);
    expect(tg[0].label).toBe("Search: “pay”");
    expect(tg.find((t) => t.key === "dom").label).toBe("Domain: A, B");
  });
  it("a tag carries its full text in the tip and in the remove button's name", () => {
    const out = s(headView(state({ f: { so: ["Security officer person with a very long name", "Second"] } }), 3, 9, 0));
    expect(out).toContain('data-tip="Security officer: Security officer person with a very long name, Second"');
    expect(out).toContain('aria-label="Remove Security officer: Security officer person with a very long name, Second"');
  });
  it("Clear all shows only with a tag", () => {
    expect(s(headView(state(), 1, 1, 0))).not.toContain('data-act="clear-all"');
    expect(s(headView(state({ q: "x" }), 1, 1, 0))).toContain('data-act="clear-all"');
  });
  it("the Filters button (small screens) carries the number of selected values", () => {
    expect(s(headView(state({ f: { dom: ["A", "B"], tier: ["T1"] } }), 1, 1, 0))).toContain("Filters (3)");
  });
});

describe("hostile values are escaped in every view", () => {
  const f = { dom: [BAD], so: [BAD] };
  const st = state({ q: BAD, f });
  const open = { open: new Set(PANEL_FACETS), finds: { dom: BAD, so: BAD } };
  const views = {
    panel: facetPanelView(st, rows, open),
    head: headView(st, 1, 1, 0),
    checklist: checklist({ key: "dom", options: facetOptions(rows, { q: "", f }, "dom"), find: BAD, scope: "side" }),
  };
  for (const [name, v] of Object.entries(views)) {
    it(name + " carries no live tag or event attribute from a value", () => {
      const t = tags(s(v));
      expect(t.length).toBeGreaterThan(0);
      for (const x of t) {
        expect(["img", "script", "iframe", "style"]).not.toContain(x.name);
        for (const a of x.attrs) expect(a.startsWith("on")).toBe(false);
      }
    });
  }
  it("the value is present, escaped", () => {
    expect(s(views.panel)).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(s(views.head)).toContain("&lt;img");
  });
  it("a double quote cannot break out of an attribute", () => {
    const evil = '" autofocus onfocus="alert(1)';
    const out = s(headView(state({ f: { dom: [evil] } }), 1, 1, 0));
    for (const x of tags(out)) expect(x.attrs).not.toContain("onfocus");
    expect(out).toContain("&quot; autofocus onfocus=&quot;alert(1)");
  });
  it("no title attributes anywhere", () => {
    for (const v of Object.values(views)) expect(s(v)).not.toMatch(/\stitle=/);
  });
});
