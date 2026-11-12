// The pill toolbar, facet checklists and the right filter panel as pure views: pill
// labels, skip-semantics counts, muted zero rows, find, chips, the saved panel state and the
// escaping of hostile values. The DOM behaviour (popover focus, outside click, sync) is in
// e2e/filters.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checklist, facetPopover, findOptions } from "../../src/client/components/facetList.js";
import { panelView, readSide, writeSide } from "../../src/client/components/filterPanel.js";
import { PILL_FACETS, chipKeys, filtersShell, frameView, pillLabel, pillTip, rowView, toggled, withFacet } from "../../src/client/components/toolbar.js";
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

describe("pill labels", () => {
  it("shows the facet name, then the first value, then +n", () => {
    expect(pillLabel("dom", [])).toBe("Domain");
    expect(pillLabel("dom", undefined)).toBe("Domain");
    expect(pillLabel("dom", ["NORTH"])).toBe("Domain: NORTH");
    expect(pillLabel("dom", ["NORTH", "SOUTH", "EAST"])).toBe("Domain: NORTH +2");
    expect(pillLabel("so", [])).toBe("Security officer");
    expect(pillLabel("so", ["Zoé Martin"])).toBe("Officer: Zoé Martin");
    expect(pillLabel("gap", ["Cyber", "Platform"])).toBe("Gap in: Cyber +1");
  });
  it("the five pills are Tier, Domain, Lifecycle, Security officer and Gap in", () => {
    const out = s(rowView(state(), null));
    const labels = [...out.matchAll(/data-act="open"[^>]*><span>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Tier", "Domain", "Lifecycle", "Security officer", "Gap in"]);
    expect(PILL_FACETS).toEqual(["dom", "lc", "so", "gap"]);
  });
  it("marks a pill with a selection as on", () => {
    const out = s(rowView(state({ f: { lc: ["Production"] } }), null));
    expect(out).toMatch(/class="pill on"[^>]*data-facet="lc"/);
    expect(out).toMatch(/class="pill"[^>]*data-facet="dom"/);
  });
});

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
  it("chips cover every selected facet except tier", () => {
    expect(chipKeys({ tier: ["T1"], dom: ["A"], sd: ["x"], lc: [] })).toEqual(["dom", "sd"]);
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
    const out = s(checklist({ key: "lc", options, find: "", scope: "pop" }));
    expect(out).toContain('<label class="ck zero">');
    const zero = [...out.matchAll(/<label class="ck( zero)?">.*?<small>(\d+)<\/small>/g)].map((m) => [!!m[1], m[2]]);
    for (const [muted, n] of zero) expect(muted).toBe(n === "0");
    expect(zero.some(([muted]) => muted)).toBe(true);
    expect(zero.some(([muted]) => !muted)).toBe(true);
  });
  it("a gap row carries a bad dot", () => {
    const out = s(checklist({ key: "gap", options: [{ value: "Cyber", count: 2, selected: false }], find: "", scope: "pop" }));
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
    expect(s(checklist({ key: "so", options: opts, find: "qqqq", scope: "pop" }))).toContain("Nothing matches");
  });
  it("Domain and Officer get a find box, Lifecycle and Gap in do not", () => {
    const pop = (key, big) => s(facetPopover({ key, label: key, big, find: "", options: facetOptions(rows, { q: "", f: {} }, key) }));
    expect(pop("dom", true)).toContain('type="search"');
    expect(pop("so", true)).toContain('type="search"');
    expect(pop("lc", false)).not.toContain('type="search"');
    expect(pop("gap", false)).not.toContain('type="search"');
  });
  it("the popover footer says how many are selected", () => {
    const options = facetOptions(rows, { q: "", f: { dom: ["NORTH"] } }, "dom");
    expect(s(facetPopover({ key: "dom", label: "Domain", big: true, find: "", options }))).toContain("<span>1 selected</span>");
  });
  it("the find box keeps its text and is focus-keyed", () => {
    const out = s(facetPopover({ key: "dom", label: "Domain", big: true, find: "no", options: [] }));
    expect(out).toContain('value="no"');
    expect(out).toContain('data-k="find-pop-dom"');
  });
});

describe("checkbox focus keys", () => {
  it("each checkbox has a stable data-k, distinct between popover and panel", () => {
    const options = [{ value: "NORTH", count: 1, selected: true }];
    expect(s(checklist({ key: "dom", options, find: "", scope: "pop" }))).toContain('data-k="pop-dom-NORTH"');
    expect(s(checklist({ key: "dom", options, find: "", scope: "side" }))).toContain('data-k="side-dom-NORTH"');
    expect(s(checklist({ key: "dom", options, find: "", scope: "pop" }))).toContain("checked");
  });
  it("the scrolling list keeps its position across a re-render", () => {
    expect(s(checklist({ key: "dom", options: [], find: "", scope: "pop" }))).toContain('data-keep-scroll="pop-dom"');
  });
});

describe("the tier pill", () => {
  it("is labelled Tier with nothing selected and lists the selected tiers", () => {
    expect(pillLabel("tier", [])).toBe("Tier");
    expect(pillLabel("tier", ["T1", "T2"])).toBe("Tier: 1, 2");
    expect(pillLabel("tier", ["T1", "No tier"])).toBe("Tier: 1, No tier");
  });
  it("is the first pill, opens the same popover as the others and marks a selection as on", () => {
    const out = s(rowView(state({ f: { tier: ["T1", "T2"] } }), null));
    expect(out).toMatch(/class="pill on"[^>]*data-act="open" data-facet="tier" data-k="pill-tier" aria-haspopup="dialog" aria-expanded="false"/);
    expect(out.indexOf('data-facet="tier"')).toBeLessThan(out.indexOf('data-facet="dom"'));
    expect(out).not.toContain('role="group" aria-label="Tier"');
    expect(out).not.toContain('data-act="tier"');
  });
  it("stays in the row while the panel is open, ahead of the chips", () => {
    const out = s(rowView(state({ f: { tier: ["T1"], dom: ["A"] }, side: true }), null));
    expect(out).toContain('data-facet="tier" data-k="pill-tier"');
    expect(out.indexOf("pill-tier")).toBeLessThan(out.indexOf('class="chip"'));
    expect(out).not.toContain('data-facet="dom" data-k="pill-dom"');
  });
  it("its checklist counts like the others and shows No tier with a dashed none dot", () => {
    const options = facetOptions(rows, { q: "", f: {} }, "tier");
    const out = s(checklist({ key: "tier", options, find: "", scope: "pop" }));
    expect([...out.matchAll(/data-v="([^"]*)"/g)].map((m) => m[1])).toEqual(["T1", "T2", "No tier"]);
    expect(out).toMatch(/data-v="T1"[^>]*>.*?<small>2<\/small>/);
    expect(out).toMatch(/class="dot none".*<span>No tier<\/span><small>1<\/small>/);
    expect((out.match(/class="dot none"/g) || []).length).toBe(1);
  });
});

describe("active pill values", () => {
  const long = ["Security officer person with a very long name", "Second"];
  it("carry the full list in the tip and the accessible name, from the same text", () => {
    expect(pillTip("so", long)).toBe("Security officer: Security officer person with a very long name, Second");
    const out = s(rowView(state({ f: { so: long, dom: ["A", "B", "C"] } }), null));
    expect(out).toMatch(/data-facet="so"[^>]*aria-label="Security officer: Security officer person with a very long name, Second" data-tip="Security officer: Security officer person with a very long name, Second"/);
    expect(out).toContain('aria-label="Domain: A, B, C" data-tip="Domain: A, B, C"');
    expect(out).toContain("<span>Domain: A +2</span>");
  });
  it("an inactive pill has no tip: its visible name is the name", () => {
    expect(pillTip("dom", [])).toBe("");
    const out = s(rowView(state(), null));
    expect(out).not.toMatch(/data-facet="dom"[^>]*data-tip/);
  });
  it("a tier tip names the stored values", () => {
    expect(s(rowView(state({ f: { tier: ["T1", "No tier"] } }), null))).toContain('aria-label="Tier: T1, No tier" data-tip="Tier: T1, No tier"');
  });
});

describe("clear all, count badge, filter panel button", () => {
  it("Clear all shows only with a filter or a search", () => {
    expect(s(rowView(state(), null))).not.toContain("clear-all");
    expect(s(rowView(state({ q: "x" }), null))).toContain('data-act="clear-all"');
    expect(s(rowView(state({ f: { dom: ["A"] } }), null))).toContain('data-act="clear-all"');
  });
  it("the Filter panel button is an icon with the number of selected values and its pressed state", () => {
    const out = s(rowView(state({ f: { dom: ["A", "B"], tier: ["T1"] }, side: true }), null));
    expect(out).toContain('<span class="badge">3</span>');
    expect(out).toMatch(/data-act="side"[^>]*aria-pressed="true"/);
    expect(out).toContain('aria-label="Filter panel, 3 filters" data-tip="Filter panel, 3 filters"');
    expect(out).not.toContain("<span>Filter panel</span>");
  });
  it("the Filter panel button is named plainly with no filter and singular with one", () => {
    expect(s(rowView(state(), null))).toContain('aria-label="Filter panel" data-tip="Filter panel"');
    expect(s(rowView(state({ f: { dom: ["A"] } }), null))).toContain('aria-label="Filter panel, 1 filter"');
    expect(s(rowView(state(), null))).not.toContain("badge");
  });
  it("chips replace the pills while the panel is open", () => {
    const closed = s(rowView(state({ f: { dom: ["A"] } }), null));
    const open = s(rowView(state({ f: { dom: ["A"] }, side: true }), null));
    expect(closed).toContain('data-act="open"');
    expect(closed).not.toContain('class="chip"');
    expect(open).not.toContain('data-facet="dom" data-k="pill-dom"');
    expect(open).toContain('class="chip"');
    expect(open).toContain('aria-label="Remove Domain: A"');
  });
  it("the pill reflects an open popover with aria-expanded", () => {
    expect(s(rowView(state(), "so"))).toMatch(/data-facet="so"[^>]*aria-expanded="true"/);
    expect(s(rowView(state(), "so"))).toMatch(/data-facet="dom"[^>]*aria-expanded="false"/);
  });
});

describe("the filter panel", () => {
  it("is empty while closed", () => {
    expect(s(panelView(state({ side: false }), rows, PILL_FACETS, {}))).toBe("");
  });
  it("lists the four facets with the same counts as the pills", () => {
    const st = state({ side: true, f: { dom: ["NORTH"] } });
    const out = s(panelView(st, rows, PILL_FACETS, {}));
    expect(out.match(/<fieldset/g)).toHaveLength(4);
    expect(out).toContain("Domain · 1");
    expect(out).toContain('aria-label="Filter panel"');
    expect(out).toContain('data-act="side"');
    const pop = s(facetPopover({ key: "dom", label: "Domain", big: true, find: "", options: facetOptions(rows, { q: "", f: st.f }, "dom") }));
    const small = (h) => [...h.matchAll(/data-v="([^"]*)"[^>]*>.*?<small>(\d+)<\/small>/g)].map((m) => m[1] + m[2]).join();
    expect(small(out.slice(out.indexOf("Domain"), out.indexOf("Lifecycle")))).toBe(small(pop));
  });
  it("a find text narrows its own section only", () => {
    const out = s(panelView(state({ side: true }), rows, PILL_FACETS, { so: "moreau" }));
    expect(out).toContain('value="moreau"');
    expect(out).not.toContain("Zoé Martin");
    expect(out).toContain("Zoe Moreau");
    expect(out).toContain("NORTH");
  });
});

describe("the saved panel state", () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } } };
  });
  afterEach(() => { delete globalThis.window; });
  it("persists under cccp.side", () => {
    expect(readSide()).toBeNull();
    expect(writeSide(true)).toBe(true);
    expect(store.get("cccp.side")).toBe("1");
    expect(readSide()).toBe(true);
    writeSide(false);
    expect(store.get("cccp.side")).toBe("0");
    expect(readSide()).toBe(false);
  });
  it("ignores junk and survives a refusing store", () => {
    store.set("cccp.side", "maybe");
    expect(readSide()).toBeNull();
    globalThis.window = { get localStorage() { throw new Error("blocked"); } };
    expect(readSide()).toBeNull();
    expect(writeSide(true)).toBe(false);
  });
});

describe("hostile values are escaped in every view", () => {
  const f = { dom: [BAD], so: [BAD] };
  const st = state({ side: true, q: BAD, f });
  const views = {
    row: rowView(st, null),
    rowPills: rowView({ ...st, side: false }, null),
    frame: frameView(),
    popover: facetPopover({ key: "dom", label: "Domain", big: true, find: BAD, options: facetOptions(rows, { q: "", f }, "dom") }),
    panel: panelView(st, rows, PILL_FACETS, { dom: BAD, so: BAD }),
    shell: filtersShell(frameView()),
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
    expect(s(views.row)).toContain("&lt;img");
  });
  it("a double quote cannot break out of an attribute", () => {
    const evil = '" autofocus onfocus="alert(1)';
    const out = s(rowView(state({ side: true, f: { dom: [evil] } }), null));
    for (const x of tags(out)) expect(x.attrs).not.toContain("onfocus");
    expect(out).toContain("&quot; autofocus onfocus=&quot;alert(1)");
  });
  it("no title attributes anywhere", () => {
    for (const v of Object.values(views)) expect(s(v)).not.toMatch(/\stitle=/);
  });
});
