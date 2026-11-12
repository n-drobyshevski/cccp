// The CSV export: formula defence, BOM, CRLF, quoting, visible column order, every filtered row.
import { describe, expect, it } from "vitest";
import { BOM, csvLine, exportName, toCsv } from "../../src/client/export/csv.js";
import { runQuery } from "../../src/domain/query";
import { exportHeader, exportRows } from "../../src/domain/exportRows";
import { visibleColumnDefs } from "../../src/domain/columns";
import { DEFAULT_RULES } from "../../src/domain/rules";
import * as register from "../../src/client/state/register.js";
import { initialState } from "../../src/client/state/store.js";
import { mk } from "../domain/mk";

const display = { opensOn: "list", theme: "system", hidePrefix: "", hideEol: false };
const apps = Array.from({ length: 120 }, (_, i) => mk({ id: "id" + i, name: "App " + String(i).padStart(3, "0"), domain: i % 2 ? "NORTH" : "SOUTH", tier: (i % 4) + 1, lifecycle: "PRODUCTION" }));
const rows = register.derive(apps, { rules: DEFAULT_RULES, display, today: "2026-11-11" }).rows;

describe("toCsv", () => {
  it("prefixes a formula with an apostrophe", () => {
    expect(csvLine(["=HYPERLINK(1)"])).toBe("'=HYPERLINK(1)");
    expect(csvLine(["+1", "-2", "@x", "\tt"])).toBe("'+1,'-2,'@x,'\tt");
    expect(toCsv([["h"], ["=HYPERLINK(1)"]])).toContain("\r\n'=HYPERLINK(1)\r\n");
  });
  it("never prefixes a number, even a negative one", () => {
    expect(csvLine([-2, 0, 41.5])).toBe("-2,0,41.5");
  });
  it("starts with a byte-order mark and ends every line with CRLF", () => {
    const t = toCsv([["a", "b"], ["1", "2"]]);
    expect(t.charCodeAt(0)).toBe(0xfeff);
    expect(t.startsWith(BOM)).toBe(true);
    expect(t).toBe(BOM + "a,b\r\n1,2\r\n");
  });
  it("quotes commas, quotes and line breaks, and keeps accents", () => {
    expect(csvLine(['a,b', 'say "hi"', "l1\nl2", "Zoé 日本 \u{1f600}"])).toBe('"a,b","say ""hi""","l1\nl2",Zoé 日本 \u{1f600}');
  });
  it("leaves null as an empty cell", () => {
    expect(csvLine([null, undefined, ""])).toBe(",,");
  });
});

describe("the export of a list", () => {
  it("follows the visible column order, one header per head, Status expanded", () => {
    const s = { ...initialState(), cols: ["-d", "+sd"], sort: "n" };
    const cols = visibleColumnDefs(s.cols, s.sort);
    const m = exportRows(rows, cols);
    const head = m[0];
    expect(head).toEqual(exportHeader(cols));
    expect(head.indexOf("Subdomain")).toBeGreaterThan(head.indexOf("Application"));
    expect(head).not.toContain("Domain");
    expect(head.slice(-8)).toEqual(["Cyber", "Compliance", "Continuity", "Platform", "Cyber reason", "Compliance reason", "Continuity reason", "Platform reason"]);
    const lines = toCsv(m).slice(1).split("\r\n");
    expect(lines[0].split(",")).toHaveLength(head.length);
  });
  it("exports all filtered rows, not the drawn page", () => {
    const s = { ...initialState(), f: { dom: ["NORTH"] }, sort: "n", desc: false };
    const filtered = runQuery(rows, s);
    expect(filtered.length).toBe(60);
    const text = toCsv(exportRows(filtered, visibleColumnDefs(s.cols, s.sort)));
    const lines = text.slice(1).split("\r\n").filter((l) => l !== "");
    expect(lines).toHaveLength(61);
    expect(lines[1].startsWith("App 001")).toBe(true);
  });
  it("follows the active sort", () => {
    const s = { ...initialState(), sort: "n", desc: true };
    const lines = toCsv(exportRows(runQuery(rows, s), visibleColumnDefs(s.cols, s.sort))).slice(1).split("\r\n");
    expect(lines[1].startsWith("App 119")).toBe(true);
  });
});

describe("exportName", () => {
  it("is cccp-<route>-<today>.<ext>", () => {
    expect(exportName("list", "2026-11-11", "csv")).toBe("cccp-list-2026-11-11.csv");
    expect(exportName("", "", "xlsx")).toBe("cccp-export.xlsx");
    expect(exportName("../x/y", "2026-11-11", "csv")).toBe("cccp-xy-2026-11-11.csv");
  });
});
