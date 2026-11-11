import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { genWorkbook } from "../../dev/genTabs.mjs";
import { GAS_GLOBALS, installGasEnv, useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true });
const g = globalThis as any;
const WRITE = "CCCP must never write to the source sheet";

describe("gasEnv", () => {
  it("installs the globals and restores what was there", () => {
    const before = Object.fromEntries(GAS_GLOBALS.map((n) => [n, g[n]]));
    const marker = { sentinel: true };
    g.Drive = marker;
    const env = installGasEnv();
    expect(g.Drive).not.toBe(marker);
    expect(typeof g.CacheService.getScriptCache).toBe("function");
    env.uninstall();
    expect(g.Drive).toBe(marker);
    g.Drive = before.Drive;
    for (const n of GAS_GLOBALS) expect(g[n]).toBe(before[n]);
  });
  it("refuses the per-user stores", () => {
    expect(() => PropertiesService.getUserProperties()).toThrow(/UserProperties/);
    expect(() => CacheService.getUserCache()).toThrow();
  });
});

describe("CacheService", () => {
  it("expires after the TTL and defaults to 600 seconds", () => {
    const c = CacheService.getScriptCache();
    c.put("a", "1", 60);
    c.put("b", "2");
    expect(c.get("a")).toBe("1");
    fakes().advance(59_000);
    expect(c.get("a")).toBe("1");
    fakes().advance(2_000);
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).toBe("2");
    fakes().advance(600_000);
    expect(c.get("b")).toBeNull();
  });
  it("caps the TTL at 21600 seconds and the value at 100 KB", () => {
    const c = CacheService.getScriptCache();
    c.put("long", "x", 999_999);
    fakes().advance(21_599_000);
    expect(c.get("long")).toBe("x");
    fakes().advance(2_000);
    expect(c.get("long")).toBeNull();
    expect(() => c.put("big", "y".repeat(100 * 1024 + 1))).toThrow(/too large/);
  });
  it("supports getAll, putAll, remove and counts hits", () => {
    const c = CacheService.getScriptCache();
    c.putAll({ p: "1", q: "2" }, 100);
    expect(c.getAll(["p", "q", "r"])).toEqual({ p: "1", q: "2" });
    c.removeAll(["p"]);
    expect(c.get("p")).toBeNull();
    expect(fakes().counters().cacheHit).toBe(2);
  });
});

describe("LockService", () => {
  it("grants the lock, and times out when another execution holds it", () => {
    const lock = LockService.getScriptLock();
    expect(lock.tryLock(1000)).toBe(true);
    expect(lock.hasLock()).toBe(true);
    lock.releaseLock();
    expect(lock.hasLock()).toBe(false);
    fakes().holdLock(true);
    expect(lock.tryLock(500)).toBe(false);
    expect(() => lock.waitLock(30_000)).toThrow(/Lock timeout.*30000 milliseconds/);
    fakes().holdLock(false);
    expect(() => lock.waitLock(30_000)).not.toThrow();
  });
});

describe("Utilities.formatDate", () => {
  const d = new Date(Date.UTC(2026, 0, 1, 23, 30, 5));
  it("formats in the given zone", () => {
    expect(Utilities.formatDate(d, "UTC", "yyyy-MM-dd HH:mm:ss")).toBe("2026-01-01 23:30:05");
    expect(Utilities.formatDate(d, "Europe/Paris", "yyyy-MM-dd")).toBe("2026-01-02");
    expect(Utilities.formatDate(d, "Pacific/Kiritimati", "yyyy-MM-dd HH:mm")).toBe("2026-01-02 13:30");
    expect(Utilities.formatDate(d, "America/Los_Angeles", "yyyy-MM-dd")).toBe("2026-01-01");
  });
  it("handles literals and zone offsets", () => {
    expect(Utilities.formatDate(d, "Europe/Paris", "yyyy-MM-dd'T'HH:mm:ssXXX")).toBe("2026-01-02T00:30:05+01:00");
    expect(Utilities.formatDate(new Date(Date.UTC(2026, 6, 1)), "Europe/Paris", "Z")).toBe("+0200");
  });
});

describe("Utilities gzip and base64", () => {
  it("round-trips base64 text and bytes", () => {
    expect(Utilities.base64Encode("héllo")).toBe(Buffer.from("héllo").toString("base64"));
    const bytes = Utilities.base64Decode("AP8AgA==");
    expect(bytes).toEqual([0, -1, 0, -128]);
    expect(Utilities.base64Encode(bytes)).toBe("AP8AgA==");
  });
  it("gzips for real under node and ungzips back", () => {
    const text = JSON.stringify({ rows: Array.from({ length: 500 }, (_, i) => ["same", i]) });
    const gz = Utilities.gzip(Utilities.newBlob(text, "application/json", "x.json"));
    const bytes = gz.getBytes();
    expect(bytes[0] & 0xff).toBe(0x1f);
    expect(bytes[1] & 0xff).toBe(0x8b);
    expect(bytes.length).toBeLessThan(text.length / 2);
    const b64 = Utilities.base64Encode(bytes);
    const back = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64)));
    expect(back.getDataAsString()).toBe(text);
  });
});

describe("SpreadsheetApp read API", () => {
  const id = () => genWorkbook().id;
  it("opens by id and by url", () => {
    const a = SpreadsheetApp.openById(id());
    const b = SpreadsheetApp.openByUrl(a.getUrl());
    expect(b.getId()).toBe(id());
    expect(a.getUrl()).toBe(["https:", "", "docs.google.com", "spreadsheets", "d", id(), "edit"].join("/"));
    expect(a.getName()).toBe("CCCP dev register");
    expect(a.getSpreadsheetTimeZone()).toBe("Europe/Paris");
    expect(() => SpreadsheetApp.openById("nope")).toThrow(/permission/);
    expect(() => SpreadsheetApp.openByUrl("not a url")).toThrow();
  });
  it("lists sheets with names and ids", () => {
    const ss = SpreadsheetApp.openById(id());
    expect(ss.getSheets().map((s) => s.getName())).toEqual(["Apps", "CIAT", "Audits", "DRP", "Platform"]);
    expect(ss.getSheetByName("DRP")!.getSheetId()).toBe(1003);
    expect(ss.getSheetByName("Missing")).toBeNull();
  });
  it("returns values with Dates at midnight in the sheet zone, and display strings", () => {
    const ss = SpreadsheetApp.openById(id());
    const sh = ss.getSheetByName("CIAT")!;
    const range = sh.getDataRange();
    const values = range.getValues();
    const display = range.getDisplayValues();
    expect(values.length).toBe(sh.getLastRow());
    expect(values[0]).toEqual(display[0]);
    const c = values[0].indexOf("Date of Security Check");
    const row = values.findIndex((r, i) => i > 0 && r[c] instanceof Date);
    expect(row).toBeGreaterThan(0);
    const dt = values[row][c] as Date;
    expect(Utilities.formatDate(dt, "Europe/Paris", "HH:mm")).toBe("00:00");
    expect(display[row][c]).toBe(Utilities.formatDate(dt, "Europe/Paris", "yyyy-MM-dd"));
    expect(typeof values[row][1]).toBe("number");
    expect(display[row][1]).toBe(String(values[row][1]));
  });
  it("hands out copies, and honours the tz flag", () => {
    const ss = SpreadsheetApp.openById(id());
    const sh = ss.getSheetByName("Apps")!;
    const v = sh.getDataRange().getValues();
    v[0][0] = "tampered";
    expect(sh.getDataRange().getValues()[0][0]).toBe("UUID");
    expect(sh.getRange(1, 1, 2, 2).getValues().length).toBe(2);
    fakes().loadWorkbook(genWorkbook(), { tz: "Pacific/Kiritimati" });
    expect(SpreadsheetApp.openById(id()).getSpreadsheetTimeZone()).toBe("Pacific/Kiritimati");
  });
  it("throws on every mutator", () => {
    const ss = SpreadsheetApp.openById(id());
    const sh = ss.getSheetByName("Apps")!;
    const rng = sh.getRange(1, 1);
    for (const fn of [
      () => ss.rename("x"), () => ss.insertSheet(), () => ss.deleteSheet(sh), () => ss.addEditor("a@b.c"),
      () => sh.appendRow(["x"]), () => sh.clear(), () => sh.deleteRow(2), () => sh.insertRowAfter(1), () => sh.setName("n"),
      () => sh.sort(1), () => sh.setFrozenRows(1),
      () => rng.setValue("x"), () => rng.setValues([["x"]]), () => rng.clearContent(), () => rng.setNote("n"),
      () => rng.setBackground("#000"), () => rng.merge(), () => rng.copyTo(rng),
      () => SpreadsheetApp.create("x"),
    ]) expect(fn).toThrow(WRITE);
  });
  it("fails when the source is not accessible", () => {
    fakes().setSourceAccess(false);
    expect(() => SpreadsheetApp.openById(id())).toThrow(/permission/);
  });
});

describe("Sheets and Drive fakes", () => {
  it("records create, values update, batchUpdate and permissions create", () => {
    const made = Sheets!.Spreadsheets!.create({ properties: { title: "CCCP export" } });
    const sid = made.spreadsheetId!;
    Sheets!.Spreadsheets!.Values!.update({ values: [["a", "b"], [1, 2]] }, sid, "Sheet1!A1", { valueInputOption: "RAW" });
    Sheets!.Spreadsheets!.batchUpdate({ requests: [{ repeatCell: {} }] }, sid);
    Drive!.Permissions!.create({ type: "user", role: "reader", emailAddress: "viewer@example.com" }, sid, { sendNotificationEmail: false });
    expect(fakes().calls().map((c) => c.svc)).toEqual([
      "Sheets.Spreadsheets.create", "Sheets.Spreadsheets.Values.update",
      "Sheets.Spreadsheets.batchUpdate", "Drive.Permissions.create",
    ]);
    const ex = fakes().exports();
    expect(ex).toHaveLength(1);
    expect(ex[0].values["Sheet1!A1"]).toEqual([["a", "b"], [1, 2]]);
    expect(ex[0].permissions).toHaveLength(1);
    expect(() => SpreadsheetApp.openById(sid)).toThrow(/permission/);
  });
});

describe("entry.js through the shims", () => {
  it("api_bootstrap goes through timedApi_ and logs the timing line", () => {
    const logs: string[] = [];
    const src = readFileSync(new URL("../../src/gas/entry.js", import.meta.url), "utf8");
    const ctx: any = {
      console: { log: (s: string) => logs.push(s) },
      Date,
      JSON,
      Server: { access: { denyResult: () => null }, api: { bootstrap: () => ({ ok: true, data: 1 }) } },
    };
    runInNewContext(src, ctx);
    expect(ctx.api_bootstrap({})).toEqual({ ok: true, data: 1 });
    const line = JSON.parse(logs[0]);
    expect(line.api).toBe("bootstrap");
    expect(typeof line.ms).toBe("number");
  });
});
