// The list as pure views: sortable headers (aria-sort, the lx3 status key, direction on first
// click), cells and their escaping, the Columns choice and its persistence, Show more and the
// empty state. The DOM behaviour (clicks, keyboard, Back and scroll) is in e2e/list.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooserRows, chooserView, readCols, writeCols } from "../../src/client/components/columnChooser.js";
import { PAGE_STEP, cell, emptyView, headCell, lifecycleClass, moreView, sortAfter, tableView } from "../../src/client/components/table.js";
import { headView, resultsView } from "../../src/client/pages/list.js";
import * as register from "../../src/client/state/register.js";
import { initialState } from "../../src/client/state/store.js";
import { queryFor } from "../../src/client/state/url.js";
import { COLUMNS, COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS, statusKey, toggleColumnKey, visibleColumnDefs } from "../../src/domain/columns";
import { runQuery } from "../../src/domain/query";
import { DEFAULT_RULES } from "../../src/domain/rules";
import { fromQuery } from "../../src/domain/viewState";
import { columnShown, toggleColumn, visibleColumns } from "../../src/vendor/gas_shared/ui/tableModel";
import { mk } from "../domain/mk";

const today = "2026-11-11";
const display = { opensOn: "list", theme: "system", hidePrefix: "", hideEol: false };
const BAD = "<img src=x onerror=alert(1)>";
const apps = [
  mk({ id: "a", name: "Alpha", domain: "NORTH", securityOfficer: "Zoé Martin", lifecycle: "PRODUCTION", tier: 1, exposed: true }),
  mk({ id: "b", name: "Beta", domain: "NORTH", lifecycle: "END_OF_LIFE", tier: 2 }),
  mk({ id: "c", name: "Gamma", domain: "SOUTH", lifecycle: "BETA", tier: null }),
  mk({ id: "d", name: BAD, domain: BAD, securityOfficer: BAD, lifecycle: null }),
];
const rows = register.derive(apps, { rules: DEFAULT_RULES, display, today }).rows;
const state = (over) => ({ ...initialState(), route: "list", ...over });
const s = (v) => String(v);
const col = (k) => COLUMN_BY_KEY[k];

describe("sortable headers", () => {
  it("the active header carries aria-sort, the others none", () => {
    const on = s(headCell(col("d"), "d", false));
    expect(on).toContain('aria-sort="ascending"');
    expect(s(headCell(col("d"), "d", true))).toContain('aria-sort="descending"');
    expect(s(headCell(col("o"), "d", false))).not.toContain("aria-sort");
  });
  it("every header is a button with the column key", () => {
    const out = s(headCell(col("so"), "n", false));
    expect(out).toMatch(/<th scope="col"><button type="button" class="sh" data-act="sort" data-col="so"/);
    expect(out).toContain("Security officer");
  });
  it("the status column is four heads CY CO CT PL in the pillar colours, each sorting by status", () => {
    const out = s(headCell(col("st"), "n", false));
    expect([...out.matchAll(/<th scope="col" class="p pc-(\w+)"/g)].map((m) => m[1])).toEqual(["cyber", "compliance", "continuity", "platform"]);
    expect([...out.matchAll(/data-col="st"[^>]*>(CY|CO|CT|PL)/g)].map((m) => m[1])).toEqual(["CY", "CO", "CT", "PL"]);
    expect(s(headCell(col("st"), "st", true)).match(/aria-sort="descending"/g).length).toBe(1);
  });
  it("each status head names its pillar in the tip and the accessible name", () => {
    const out = s(headCell(col("st"), "n", false));
    expect(out).toContain('data-tip="Cyber: status. Sort by status."');
    expect(out).toContain('aria-label="Platform: status. Sort by status."');
    expect(s(headCell(col("n"), "n", false))).not.toContain("data-tip");
  });
  it("long domain, owner and officer values are cut in the cell and keep the full text in the tip", () => {
    const r = rows[0];
    for (const k of ["d", "o", "so"]) {
      const out = s(cell(col(k), { ...r, app: { ...r.app, domain: "Long domain", owner: "Long owner", securityOfficer: "Long officer" } }));
      expect(out).toContain('class="ell"');
      expect(out).toMatch(/data-tip="Long (domain|owner|officer)"/);
    }
  });
  it("a first click follows the column's own direction, a second reverses it", () => {
    expect(sortAfter("n", false, col("d"))).toEqual({ sort: "d", desc: false });
    expect(sortAfter("n", false, col("st"))).toEqual({ sort: "st", desc: true });
    expect(sortAfter("st", true, col("st"))).toEqual({ sort: "st", desc: false });
    expect(sortAfter("d", false, col("d"))).toEqual({ sort: "d", desc: true });
    expect(sortAfter("d", true, col("d"))).toEqual({ sort: "d", desc: false });
  });
  it("the sort is carried in the URL", () => {
    const q = queryFor(state({ sort: "so", desc: true }));
    expect(q).toContain("sort=so");
    expect(q).toContain("desc=1");
    const back = fromQuery(q).state;
    expect(back.sort).toBe("so");
    expect(back.desc).toBe(true);
    expect(queryFor(state())).not.toContain("sort=");
  });
});

describe("the status sort key", () => {
  it("is bad*100 + warn*10 and sorts worst first on a first click", () => {
    const keys = rows.map((r) => [r.app.id, statusKey(r)]);
    const byId = Object.fromEntries(keys);
    expect(byId.a).toBeGreaterThanOrEqual(100);
    const first = sortAfter("n", false, col("st"));
    const ordered = runQuery(rows, { q: "", f: {}, ...first }).map((r) => statusKey(r));
    expect(ordered).toEqual([...ordered].sort((x, y) => y - x));
    expect(ordered[0]).toBeGreaterThan(ordered[ordered.length - 1]);
  });
});

describe("cells", () => {
  it("the name is a button that holds the name", () => {
    const out = s(cell(col("n"), rows[0]));
    expect(out).toMatch(/^<button type="button" class="nm"/);
    expect(out).toContain(">Alpha</button>");
  });
  it("escapes every value from the register", () => {
    const out = s(tableView({ cols: visibleColumnDefs([], "n"), rows: [rows[3]], sort: "n", desc: false }));
    expect(out).not.toContain("<img");
    expect(out.match(/&lt;img/g).length).toBeGreaterThanOrEqual(4);
  });
  it("a missing value is a dash with words for a screen reader", () => {
    expect(s(cell(col("sd"), rows[0]))).toContain("Not set");
    expect(s(cell(col("so"), rows[1]))).toContain("None assigned");
    expect(s(cell(col("t"), rows[2]))).toContain("t0");
    expect(s(cell(col("t"), rows[0]))).toContain(">T1<");
  });
  it("lifecycle is coloured by group", () => {
    expect(lifecycleClass("PRODUCTION")).toBe("ga");
    expect(lifecycleClass("end of life")).toBe("eol");
    expect(lifecycleClass("BETA")).toBe("beta");
    expect(lifecycleClass("whatever")).toBe("");
    expect(s(cell(col("lc"), rows[1]))).toContain("End of life");
  });
  it("completeness is a bar with its number, status is four glyphs in CY CO CT PL order", () => {
    const q = s(cell(col("q"), rows[0]));
    expect(q).toContain("qbar");
    expect(q).toContain(rows[0].pct + "%");
    const st = s(cell(col("st"), rows[0]));
    expect([...st.matchAll(/aria-label="(Cyber|Compliance|Continuity|Platform):/g)].map((m) => m[1])).toEqual(["Cyber", "Compliance", "Continuity", "Platform"]);
  });
  it("a table row has four status cells after the other columns", () => {
    const out = s(tableView({ cols: visibleColumnDefs([], "n"), rows: [rows[0]], sort: "n", desc: false }));
    expect([...out.matchAll(/<td class="p" data-col="st" data-pillar="(\w+)"/g)].map((m) => m[1])).toEqual(["cyber", "compliance", "continuity", "platform"]);
    expect([...out.matchAll(/<th /g)].length).toBe(DEFAULT_COLUMN_KEYS.length + 3);
    expect([...out.matchAll(/<td /g)].length).toBe(DEFAULT_COLUMN_KEYS.length + 3);
  });
  it("the table draws one row per row, with its id", () => {
    const out = s(tableView({ cols: visibleColumnDefs([], "n"), rows, sort: "n", desc: false }));
    expect([...out.matchAll(/<tr data-id="([^"]*)"/g)].map((m) => m[1])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("columns", () => {
  const mem = new Map();
  beforeEach(() => {
    mem.clear();
    globalThis.window = { localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } } };
  });
  afterEach(() => { delete globalThis.window; });

  it("the defaults are the lx3 set, in the registry order", () => {
    expect(visibleColumnDefs([], "n").map((c) => c.key)).toEqual(DEFAULT_COLUMN_KEYS.slice());
    expect(DEFAULT_COLUMN_KEYS).toEqual(["n", "d", "t", "lc", "o", "so", "st"]);
  });
  it("Application is fixed: it cannot be switched off", () => {
    expect(toggleColumnKey([], "n", "n")).toEqual([]);
    const r = chooserRows([], "n").find((c) => c.key === "n");
    expect(r.hideable).toBe(false);
    expect(r.shown).toBe(true);
    expect(s(chooserView([], "n"))).toMatch(/data-col="n"[^>]*checked[^>]*disabled/);
  });
  it("a toggle records a deviation, a toggle back removes it", () => {
    const off = toggleColumnKey([], "so", "n");
    expect(off).toEqual(["-so"]);
    expect(visibleColumnDefs(off, "n").map((c) => c.key)).not.toContain("so");
    expect(toggleColumnKey(off, "so", "n")).toEqual([]);
    const on = toggleColumnKey([], "ty", "n");
    expect(on).toEqual(["+ty"]);
    expect(visibleColumnDefs(on, "n").map((c) => c.key)).toContain("ty");
  });
  it("sorting by a column that is off by default shows it", () => {
    expect(visibleColumnDefs([], "ty").map((c) => c.key)).toContain("ty");
  });
  it("the choice persists in 'cccp.cols' and reads back", () => {
    expect(readCols()).toEqual([]);
    expect(writeCols(["-so", "+ty"])).toBe(true);
    expect(mem.get("cccp.cols")).toBe('["-so","+ty"]');
    expect(readCols()).toEqual(["-so", "+ty"]);
    writeCols([]);
    expect(mem.has("cccp.cols")).toBe(false);
  });
  it("junk in storage is dropped, unknown keys are inert", () => {
    mem.set("cccp.cols", "not json");
    expect(readCols()).toEqual([]);
    mem.set("cccp.cols", '{"a":1}');
    expect(readCols()).toEqual([]);
    mem.set("cccp.cols", '["-so","-gone",7,"+n"]');
    expect(readCols()).toContain("-so");
    expect(readCols()).not.toContain("-gone");
  });
  it("a refusing storage reads as no choice and writes return false", () => {
    globalThis.window = { get localStorage() { throw new Error("blocked"); } };
    expect(readCols()).toEqual([]);
    expect(writeCols(["-so"])).toBe(false);
  });
  it("a column added later shows by default for a reader with an old choice", () => {
    const before = [{ key: "n", label: "Name", pinned: true }, { key: "a", label: "A" }, { key: "b", label: "B" }];
    const after = [...before, { key: "c", label: "C" }, { key: "d", label: "D", defaultHidden: true }];
    const choice = toggleColumn(before, null, "a");
    expect(visibleColumns(before, choice).map((c) => c.key)).toEqual(["n", "b"]);
    expect(visibleColumns(after, choice).map((c) => c.key)).toEqual(["n", "b", "c"]);
    expect(columnShown(after[4], choice)).toBe(false);
  });
  it("the chooser lists every column; Reset appears only with a deviation", () => {
    const out = s(chooserView(["-so"], "n"));
    expect([...out.matchAll(/data-act="col"/g)].length).toBe(COLUMNS.length);
    expect(out).toContain("Reset to default");
    expect(s(chooserView([], "n"))).not.toContain("Reset to default");
  });
});

describe("Show more, the count and the empty state", () => {
  it("offers 50 more with the number left, then the rest, then nothing", () => {
    expect(PAGE_STEP).toBe(50);
    expect(s(moreView(50, 1125))).toContain("Show 50 more · 1,075 left");
    expect(s(moreView(1100, 1125))).toContain("Show 25 more · 25 left");
    expect(s(moreView(1125, 1125))).toBe("");
  });
  it("the results head counts N of M and notes hidden applications", () => {
    const h = s(headView(state(), 12, 1125, 0));
    expect(h).toContain('data-count="visible"><b class="num mono">12</b>');
    expect(h).toContain("of 1,125 applications");
    expect(h).not.toContain('data-count="hidden"');
    expect(s(headView(state(), 1, 1, 3))).toContain("and 3 applications hidden by the display settings");
    expect(s(headView(state(), 1, 1, 0))).toContain("of 1 application<");
  });
  it("the head holds Columns and Export as text links, and Filters for the drawer", () => {
    const h = s(headView(state(), 4, 4, 0));
    expect(h).toMatch(/<button type="button" class="tlink" data-act="cols"[^>]*>Columns<\/button>/);
    expect(h).toMatch(/<button type="button" class="tlink" data-act="export"[^>]*>Export<\/button>/);
    expect(h).toContain('data-act="fopen"');
    expect(h).toContain(">Filters<");
    expect(s(headView(state({ f: { tier: ["T1"], dom: ["A", "B"] } }), 4, 4, 0))).toContain(">Filters (3)<");
  });
  it("active filters are small tags, each removable; the search is one too", () => {
    const h = s(headView(state({ q: "pay", f: { tier: ["T1", "T2"], gap: ["Cyber"] } }), 4, 4, 0));
    expect(h).toContain("Search: \u201cpay\u201d");
    expect(h).toContain("Tier: T1, T2");
    expect(h).toContain("Gap in: Cyber");
    expect(h).toContain('data-act="rm-q"');
    expect([...h.matchAll(/data-act="clear-facet" data-facet="(\w+)"/g)].map((m) => m[1])).toEqual(["tier", "gap"]);
    expect(h).toContain('data-act="clear-all"');
    expect(s(headView(state(), 4, 4, 0))).not.toContain('class="ftag"');
  });
  it("the page draws only `limit` rows and the footer says how many are left", () => {
    const big = Array.from({ length: 120 }, (_, i) => rows[i % 3]);
    const out = s(resultsView(state(), 120, big, 0, 50));
    expect([...out.matchAll(/<tr data-id/g)].length).toBe(50);
    expect(out).toContain("Show 50 more · 70 left");
    const more = s(resultsView(state(), 120, big, 0, 100));
    expect([...more.matchAll(/<tr data-id/g)].length).toBe(100);
  });
  it("an empty result offers Clear all", () => {
    const out = s(resultsView(state({ q: "zzzz-no-match" }), 4, rows, 0, 50));
    expect(out).toContain("No application matches");
    expect(out).toContain('data-act="clear-all"');
    expect(out).not.toContain("<table");
    expect(s(emptyView(0))).not.toContain("clear-all");
  });
});
