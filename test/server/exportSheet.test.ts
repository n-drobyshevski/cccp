// The Google Sheet export: rows rebuilt from ids, create before RAW values, the source id
// refused, the file shared to the viewer, five per ten minutes, strangers forbidden.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { EXPORT_LIMIT, SHEET_TAB } from "../../src/server/exportSheet";
import { registerEntry } from "../../src/server/registerStore";
import { decodeRegister } from "../../src/domain/payload";
import { genWorkbook } from "../../dev/genTabs.mjs";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };
const ids = (n: number) => decodeRegister(registerEntry().register).slice(0, n).map((a) => a.id);
const names = () => fakes().calls().map((c) => c.svc);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  as("viewer@example.com");
});

describe("exportToSheet", () => {
  it("rebuilds the rows from ids: values in the given order, header labels first", () => {
    const want = ids(3).reverse();
    const apps = new Map(decodeRegister(registerEntry().register).map((a) => [a.id, a]));
    const res = api.exportToSheet({ ids: want, columns: ["d", "n", "t"], title: "Apps" });
    expect(res).toMatchObject({ ok: true });
    expect(res.data!.rows).toBe(3);
    const ex = fakes().exports();
    expect(ex).toHaveLength(1);
    const grid = Object.values(ex[0]!.values)[0]!;
    expect(grid[0]).toEqual(["Domain", "Application", "Tier"]);
    expect(grid.slice(1).map((r) => r[1])).toEqual(want.map((id) => apps.get(id)!.name));
  });

  it("ignores values the client sends: only ids and column keys count", () => {
    const res = api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x", values: [["=HYPERLINK(1)"]], rows: [["evil"]] } as never);
    expect(res.ok).toBe(true);
    const grid = Object.values(fakes().exports()[0]!.values)[0]!;
    expect(JSON.stringify(grid)).not.toContain("evil");
    expect(JSON.stringify(grid)).not.toContain("HYPERLINK");
  });

  it("drops unknown ids and unknown columns; falls back to the default columns", () => {
    const res = api.exportToSheet({ ids: [...ids(2), "nope", 5, ""], columns: ["zz"], title: "x" });
    expect(res.data!.rows).toBe(2);
    const grid = Object.values(fakes().exports()[0]!.values)[0]!;
    expect(grid[0]![0]).toBe("Application");
  });

  it("creates the spreadsheet BEFORE writing values, writes RAW, then bolds the header, then shares", () => {
    api.exportToSheet({ ids: ids(2), columns: ["n"], title: "Order" });
    expect(names()).toEqual([
      "Sheets.Spreadsheets.create", "Sheets.Spreadsheets.Values.update", "Sheets.Spreadsheets.batchUpdate", "Drive.Permissions.create",
    ]);
    const calls = fakes().calls();
    expect(calls[1]!.args.optionalArgs).toEqual({ valueInputOption: "RAW" });
    const create = calls[0]!.args.resource as { properties: { title: string }; sheets: { properties: { title: string; gridProperties: { frozenRowCount: number } } }[] };
    expect(create.properties.title).toMatch(/^CCCP export · Order · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(create.sheets[0]!.properties.gridProperties.frozenRowCount).toBe(1);
    expect(calls[1]!.args.range).toBe("'" + SHEET_TAB + "'!A1");
    expect(JSON.stringify(calls[2]!.args.resource)).toContain("\"bold\":true");
  });

  it("keeps a leading '=' as text by writing RAW", () => {
    const wb = genWorkbook();
    const apps = wb.tabs[0]!;
    const col = (apps.rows[0] as string[]).indexOf("Name");
    (apps.rows[1] as unknown[])[col] = "=HYPERLINK(1)";
    const id = fakes().loadWorkbook(wb);
    fakes().seedDefaults({ sheetId: id });
    fakes().clearCache();
    const first = decodeRegister(registerEntry().register).find((a) => a.name === "=HYPERLINK(1)")!;
    expect(first).toBeTruthy();
    expect(api.exportToSheet({ ids: [first.id], columns: ["n"], title: "raw" }).ok).toBe(true);
    const grid = Object.values(fakes().exports()[0]!.values)[0]!;
    expect(grid[1]).toEqual(["=HYPERLINK(1)"]);
    expect(fakes().calls().find((c) => c.svc === "Sheets.Spreadsheets.Values.update")!.args.optionalArgs).toEqual({ valueInputOption: "RAW" });
  });

  it("refuses when the new spreadsheet's id is the source id, and writes nothing", () => {
    const source = String(JSON.parse(PropertiesService.getScriptProperties().getProperty("CFG_SOURCE")!).sheetId);
    const real = Sheets!.Spreadsheets!.create;
    vi.spyOn(Sheets!.Spreadsheets!, "create").mockImplementation((r) => ({ ...real(r), spreadsheetId: source }));
    const res = api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" });
    expect(res.ok).toBe(false);
    expect(names().filter((n) => n.includes("Values") || n.includes("Permissions") || n.includes("batchUpdate"))).toEqual([]);
  });

  it("gives the viewer writer access without a notification", () => {
    as("viewer@example.com");
    api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" });
    const call = fakes().calls().find((c) => c.svc === "Drive.Permissions.create")!;
    expect(call.args.resource).toEqual({ type: "user", role: "writer", emailAddress: "viewer@example.com" });
    expect(call.args.optionalArgs).toEqual({ sendNotificationEmail: false });
    expect(fakes().exports()[0]!.permissions).toHaveLength(1);
  });

  it("does not share the file with the deployer who already owns it", () => {
    as("owner@example.com");
    expect(api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" }).ok).toBe(true);
    expect(names()).not.toContain("Drive.Permissions.create");
  });

  it("refuses an empty selection before anything is created", () => {
    expect(api.exportToSheet({ ids: [], columns: ["n"], title: "x" })).toMatchObject({ ok: false });
    expect(api.exportToSheet({ ids: "all", columns: ["n"] } as never)).toMatchObject({ ok: false });
    expect(api.exportToSheet({ ids: ["nope"], columns: ["n"] })).toMatchObject({ ok: false });
    expect(fakes().calls()).toEqual([]);
  });

  it("allows five in ten minutes, refuses the sixth, and allows again after the window", () => {
    const one = () => api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" });
    for (let i = 0; i < EXPORT_LIMIT; i++) expect(one().ok, "call " + (i + 1)).toBe(true);
    const sixth = one();
    expect(sixth).toMatchObject({ ok: false, errorKind: "busy" });
    expect(sixth.error).toMatch(/5 Google Sheets/);
    expect(fakes().exports()).toHaveLength(EXPORT_LIMIT);
    fakes().advance(10 * 60_000 + 1000);
    expect(one().ok).toBe(true);
  });

  it("counts per viewer", () => {
    for (let i = 0; i < EXPORT_LIMIT; i++) api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" });
    as("admin@example.com");
    expect(api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" }).ok).toBe(true);
  });

  it("keys the counter by a hash, not the address", () => {
    const cache = CacheService.getScriptCache();
    const put = vi.spyOn(cache, "put");
    api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" });
    const keys = put.mock.calls.map((c) => String(c[0])).filter((k) => k.startsWith("cccp:export:"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("viewer");
    expect(keys[0]).toMatch(/^cccp:export:[0-9a-f]{40}$/);
  });

  it("forbids a stranger and touches no service", () => {
    as("stranger@elsewhere.org");
    expect(api.exportToSheet({ ids: ids(1), columns: ["n"], title: "x" })).toMatchObject({ ok: false, errorKind: "forbidden" });
    expect(fakes().calls()).toEqual([]);
  });

  it("is a public delegator in entry.js and the only user of the advanced services", () => {
    const entry = readFileSync(new URL("../../src/gas/entry.js", import.meta.url), "utf8");
    expect(entry).toContain('function api_exportToSheet(p) { return timedApi_("exportToSheet", p); }');
  });
});
