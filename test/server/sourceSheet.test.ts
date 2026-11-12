// The source reader: plain arrays out, dates in the Sheet's own zone, a missing tab reported.
import { describe, expect, it, vi } from "vitest";
import type { Workbook } from "../../dev/genTabs.mjs";
import { readTabs, sampleTabs, sampleWorkbook } from "../../src/server/sourceSheet";
import { makeDefaultSettings } from "../../src/domain/settings";
import { separateTabs } from "../domain/mk";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();

const wb = (tz: string, tabs: Workbook["tabs"]): Workbook => ({
  id: "inline_sheet_0001", name: "Inline", tz, today: "2026-11-11", source: "inline",
  facts: { unmatchedId: "", duplicateId: null, textDateRow: null, renamedHeader: "", renamedFrom: "" },
  tabs,
});
const source = () => ({ sheetId: "inline_sheet_0001", tabs: separateTabs(makeDefaultSettings()).source.tabs });

describe("readTabs", () => {
  it("reads a Pacific/Auckland midnight date as the same day", () => {
    const tabs = [{ name: "Apps", gid: 7, rows: [["UUID", "Name", "Seen"], ["a", "One", { $wall: "2026-03-01" }], ["b", "Two", { $wall: "2026-01-01" }]] }];
    for (const tz of ["Pacific/Auckland", "Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
      fakes().loadWorkbook(wb(tz, tabs));
      const r = readTabs(source());
      expect(r.tz).toBe(tz);
      expect(r.tabs.apps!.rows.map((x) => x[2])).toEqual(["2026-03-01", "2026-01-01"]);
    }
  });

  it("keeps a time of day when the cell is not midnight, and turns empty cells into null", () => {
    fakes().loadWorkbook(wb("Pacific/Auckland", [{ name: "Apps", gid: 0, rows: [["UUID", "At", "Blank", "N", "B"], ["a", "x", "", 3, true]] }]));
    const real = SpreadsheetApp.openById("inline_sheet_0001");
    const sheet = real.getSheetByName("Apps")!;
    // 2026-03-01 11:30 UTC is 00:30 on 2026-03-02 in Auckland (UTC+13 in March).
    const at = new Date(Date.UTC(2026, 2, 1, 11, 30));
    const spy = vi.spyOn(sheet.getDataRange().constructor.prototype, "getValues").mockReturnValue([["UUID", "At", "Blank", "N", "B"], ["a", at, "", 3, true]]);
    const r = readTabs(source());
    spy.mockRestore();
    expect(r.tabs.apps!.rows[0]).toEqual(["a", "2026-03-02 00:30", null, 3, true]);
  });

  it("reports a missing tab instead of throwing", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Apps", gid: 0, rows: [["UUID"], ["a"]] }]));
    const r = readTabs(source());
    expect(r.tabs.apps).toMatchObject({ found: true, gid: 0, headers: ["UUID"] });
    expect(r.tabs.ciat).toEqual({ key: "ciat", name: "CIAT", gid: null, found: false, headers: [], rows: [] });
    expect(r.tabs.drp!.found).toBe(false);
  });

  it("skips a tab bound to an empty name", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Apps", gid: 0, rows: [["UUID"], ["a"]] }]));
    const s = source();
    s.tabs.plat = { ...s.tabs.plat, name: "" };
    expect(readTabs(s).tabs.plat).toBeUndefined();
  });

  it("handles an empty sheet and a header-only sheet", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Apps", gid: 0, rows: [] }, { name: "CIAT", gid: 1, rows: [["UUID", "x"]] }]));
    const r = readTabs(source());
    expect(r.tabs.apps).toMatchObject({ found: true, headers: [], rows: [] });
    expect(r.tabs.ciat).toMatchObject({ headers: ["UUID", "x"], rows: [] });
  });

  it("returns no GAS objects: the result survives a JSON round trip unchanged", () => {
    fakes().loadWorkbook(wb("Pacific/Auckland", [{ name: "Apps", gid: 0, rows: [["UUID", "D"], ["a", { $wall: "2026-02-02" }]] }]));
    const r = readTabs(source());
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const scan = (v: unknown, path: string): void => {
      expect(typeof v, path).not.toBe("function");
      if (v && typeof v === "object") {
        expect(Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v), path).toBe(true);
        for (const [k, x] of Object.entries(v)) scan(x, path + "." + k);
      }
    };
    scan(r, "read");
  });

  it("throws one sentence when the Sheet cannot be opened", () => {
    fakes().setSourceAccess(false);
    expect(() => readTabs({ sheetId: "inline_sheet_0001", tabs: makeDefaultSettings().source.tabs })).toThrow(/could not be opened/);
    expect(() => readTabs({ sheetId: "", tabs: makeDefaultSettings().source.tabs })).toThrow(/No data source/);
  });

  it("never reaches a source mutator (the fake throws on any)", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Apps", gid: 0, rows: [["UUID"], ["a"]] }]));
    expect(() => readTabs(source())).not.toThrow();
    expect(() => SpreadsheetApp.openById("inline_sheet_0001").getSheetByName("Apps")!.getRange(1, 1).setValue("x")).toThrow(fakes().WRITE_ERROR);
  });
});

describe("sampleTabs", () => {
  it("gives headers and the first non-empty example per header", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Apps", gid: 0, rows: [["UUID", "Name"], ["", "first"], ["b", "second"]] }]));
    const s = sampleTabs(source());
    expect(s.apps).toEqual({ found: true, headers: ["UUID", "Name"], examples: { UUID: "b", Name: "first" } });
  });
});

describe("Applications tab detection", () => {
  const inv = [["Name", " uuid ", "Domain"], ["One", "a", "X"], ["Two", "b", "Y"]];
  const other = [["Notes"], ["n"]];
  const defaults = () => ({ sheetId: "inline_sheet_0001", tabs: makeDefaultSettings().source.tabs });

  it("uses a configured tab that exists, as is, even when another tab has the id header", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Inventory", gid: 3, rows: inv }, { name: "Mine", gid: 4, rows: [["UUID", "Name"], ["z", "Z"]] }]));
    const s = defaults();
    s.tabs.apps = { ...s.tabs.apps, name: "Mine" };
    const r = readTabs(s);
    expect(r.tabs.apps).toMatchObject({ name: "Mine", gid: 4, found: true });
    expect(r.tabs.apps!.detected).toBeUndefined();
  });

  it("when the default Apps is absent, takes the first sheet whose header row has the id header", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Notes", gid: 1, rows: other }, { name: "Inventory", gid: 2, rows: inv }]));
    const r = readTabs(defaults());
    expect(r.tabs.apps).toMatchObject({ name: "Inventory", gid: 2, found: true, detected: true });
    expect(r.tabs.apps!.rows).toHaveLength(2);
    expect(r.sheetNames).toEqual(["Notes", "Inventory"]);
  });

  it("matches the configured id header, trimmed and case-insensitively", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "A", gid: 1, rows: [["UUID", "Name"], ["x", "y"]] }, { name: "B", gid: 2, rows: [["Key", "Name"], ["x", "y"]] }]));
    expect(readTabs(defaults(), { idHeader: " key " }).tabs.apps).toMatchObject({ name: "B", detected: true });
  });

  it("with no header match, takes the first sheet", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "First", gid: 1, rows: other }, { name: "Second", gid: 2, rows: [["Thing"]] }]));
    expect(readTabs(defaults()).tabs.apps).toMatchObject({ name: "First", gid: 1, found: true, detected: true });
  });

  it("an explicitly named tab that is absent is detected too (not silently kept missing)", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Inventory", gid: 2, rows: inv }]));
    const s = defaults();
    s.tabs.apps = { ...s.tabs.apps, name: "Register" };
    expect(readTabs(s).tabs.apps).toMatchObject({ name: "Inventory", detected: true });
  });

  it("a same-tab pillar has no tab of its own and is sampled as the Applications tab", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Inventory", gid: 2, rows: inv }]));
    const r = readTabs(defaults());
    expect(Object.keys(r.tabs)).toEqual(["apps"]);
    const w = sampleWorkbook(defaults());
    expect(w.tabNames).toEqual(["Inventory"]);
    expect(w.tabs.ciat).toEqual(w.tabs.apps);
    expect(w.tabs.apps!.headers).toEqual(["Name", " uuid ", "Domain"]);
  });

  it("a separate pillar tab still reads its own tab", () => {
    fakes().loadWorkbook(wb("UTC", [{ name: "Inventory", gid: 2, rows: inv }, { name: "CIAT", gid: 5, rows: [["UUID", "Integrity Level"], ["a", 2]] }]));
    const s = defaults();
    s.tabs.ciat = { ...s.tabs.ciat, name: "CIAT", sameTab: false };
    const r = readTabs(s);
    expect(r.tabs.ciat).toMatchObject({ name: "CIAT", gid: 5, found: true });
    expect(sampleWorkbook(s).tabs.ciat!.headers).toEqual(["UUID", "Integrity Level"]);
  });
});
