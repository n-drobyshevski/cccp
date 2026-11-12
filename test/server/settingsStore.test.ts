import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIELD_KEYS } from "../../src/domain/fields";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { cfgGen, dataVersion } from "../../src/server/serverCache";
import { loadSettings } from "../../src/server/settingsStore";
import { genOneTabWorkbook } from "../../dev/genTabs.mjs";
import { getSettingsView } from "../../src/server/settingsStore";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };
const prop = (k: string) => PropertiesService.getScriptProperties().getProperty(k);
let log: { mock: { calls: unknown[][] } };

beforeEach(() => {
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

const rules = (months: number) => ({ rules: { rules: { "co.review": { months } } } });

describe("loadSettings", () => {
  it("gives defaults for a section that is not stored and cleans a stored one", () => {
    PropertiesService.getScriptProperties().setProperty("CFG_DISPLAY", JSON.stringify({ opensOn: "bogus", hideEol: true, junk: 1 }));
    const s = loadSettings();
    expect(s.display).toEqual({ opensOn: "overview", theme: "light", hidePrefix: "", hideEol: true });
    expect(s.rules.rules["co.review"]).toEqual({ months: 12 });
  });
});

describe("saveSettings", () => {
  it("saves a rules patch as an admin: stored, generation bumped, actor logged", () => {
    as("admin@example.com");
    const res = api.saveSettings({ patch: rules(9), baseGen: 0 });
    expect(res).toMatchObject({ ok: true, data: { cfgGen: 1, clamped: [] } });
    expect(res.data!.settings.rules.rules["co.review"]).toEqual({ months: 9 });
    expect(JSON.parse(prop("CFG_RULES")!).rules["co.review"]).toEqual({ months: 9 });
    expect(prop("CFG_GEN")).toBe("1");
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"settings":"saved"')).map((l) => JSON.parse(l));
    expect(lines).toEqual([{ settings: "saved", actor: "admin@example.com", sections: ["rules"], clamped: [], cfgGen: 1 }]);
  });

  it("writes only the sections that changed", () => {
    as("admin@example.com");
    api.saveSettings({ patch: rules(9), baseGen: 0 });
    expect(prop("CFG_DISPLAY")).toBeNull();
    expect(prop("CFG_FIELDS")).toBeNull();
  });

  it("returns a conflict for a stale baseGen and writes nothing", () => {
    as("admin@example.com");
    expect(api.saveSettings({ patch: rules(9), baseGen: 0 }).ok).toBe(true);
    const stale = api.saveSettings({ patch: rules(5), baseGen: 0 });
    expect(stale).toMatchObject({ ok: false, errorKind: "conflict" });
    expect(JSON.parse(prop("CFG_RULES")!).rules["co.review"].months).toBe(9);
    expect(cfgGen()).toBe(1);
    expect(api.saveSettings({ patch: rules(5), baseGen: 1 }).ok).toBe(true);
  });

  it("refuses a missing or malformed baseGen and a missing patch", () => {
    as("admin@example.com");
    expect(api.saveSettings({ patch: rules(9) }).ok).toBe(false);
    expect(api.saveSettings({ patch: rules(9), baseGen: "x" }).ok).toBe(false);
    expect(api.saveSettings({ baseGen: 0 }).ok).toBe(false);
    expect(api.saveSettings({ patch: [1], baseGen: 0 }).ok).toBe(false);
    expect(cfgGen()).toBe(0);
  });

  it("is busy while the script lock is held, and releases it afterwards", () => {
    as("admin@example.com");
    fakes().holdLock(true);
    expect(api.saveSettings({ patch: rules(9), baseGen: 0 })).toMatchObject({ ok: false, errorKind: "busy" });
    fakes().holdLock(false);
    expect(api.saveSettings({ patch: rules(9), baseGen: 0 }).ok).toBe(true);
    expect(LockService.getScriptLock().hasLock()).toBe(false);
  });

  it("refuses a section over 8000 bytes with a sentence and leaves the stored one alone", () => {
    as("admin@example.com");
    api.saveSettings({ patch: { fields: { name: { header: "Name" } } }, baseGen: 0 });
    const before = prop("CFG_FIELDS");
    const fat: Record<string, unknown> = {};
    for (const k of FIELD_KEYS) fat[k] = { header: "é".repeat(120) };
    const res = api.saveSettings({ patch: { fields: fat }, baseGen: cfgGen() });
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("error");
    expect(res.error).toMatch(/too large to save/);
    expect(prop("CFG_FIELDS")).toBe(before);
  });

  it("refuses a patch that is itself enormous", () => {
    as("admin@example.com");
    const res = api.saveSettings({ patch: { display: { hidePrefix: "x".repeat(60_000) } }, baseGen: 0 });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/too large/);
  });

  it("returns the clamped keys, including dropped unknown ones", () => {
    as("admin@example.com");
    const res = api.saveSettings({
      patch: { source: { cacheMinutes: 99999 }, display: { bogus: 1, hidePrefix: "ok" }, rules: { rules: { "co.review": { months: 500 } } } },
      baseGen: 0,
    });
    expect(res.ok).toBe(true);
    expect(res.data!.clamped.sort()).toEqual(["display.bogus", "rules.rules.co.review.months", "source.cacheMinutes"]);
    expect(res.data!.settings.source.cacheMinutes).toBe(360);
    expect(res.data!.settings.rules.rules["co.review"]!.months).toBe(120);
  });

  it("returns validation sentences and writes nothing", () => {
    as("admin@example.com");
    const res = api.saveSettings({ patch: { source: { tabs: { apps: { name: "" } } } }, baseGen: 0 });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/Applications tab needs a name/);
    expect(prop("CFG_SOURCE")).not.toContain('"name":""');
    expect(cfgGen()).toBe(0);
  });

  it("does not bump anything when nothing changed", () => {
    as("admin@example.com");
    const res = api.saveSettings({ patch: { display: { theme: "light" } }, baseGen: 0 });
    expect(res).toMatchObject({ ok: true, data: { cfgGen: 0 } });
    expect(prop("CFG_GEN")).toBeNull();
  });

  it("REFUSES an admin sheetId patch and accepts an admin rules patch", () => {
    as("admin@example.com");
    const before = prop("CFG_SOURCE");
    const res = api.saveSettings({ patch: { source: { sheetId: "another_sheet_id_00" } }, baseGen: 0 });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/Only the owner/);
    expect(prop("CFG_SOURCE")).toBe(before);
    expect(cfgGen()).toBe(0);
    expect(api.saveSettings({ patch: rules(8), baseGen: 0 }).ok).toBe(true);
  });

  it("lets an admin resend the unchanged sheetId inside a source patch", () => {
    as("admin@example.com");
    const id = loadSettings().source.sheetId;
    expect(api.saveSettings({ patch: { source: { sheetId: id, cacheMinutes: 20 } }, baseGen: 0 }).ok).toBe(true);
  });

  it("lets the owner change the sheetId, and that bumps the data version", () => {
    as("owner@example.com");
    const d = dataVersion();
    const res = api.saveSettings({ patch: { source: { sheetId: "another_sheet_id_00" } }, baseGen: 0 });
    expect(res.ok).toBe(true);
    expect(loadSettings().source.sheetId).toBe("another_sheet_id_00");
    expect(dataVersion()).toBe(d + 1);
  });

  it("accepts a full Sheet link and keeps the id", () => {
    as("owner@example.com");
    const url = ["https:", "", "docs.google.com", "spreadsheets", "d", "abcdefghij_KLMNOP", "edit"].join("/");
    expect(api.saveSettings({ patch: { source: { sheetId: url } }, baseGen: 0 }).data!.settings.source.sheetId).toBe("abcdefghij_KLMNOP");
  });

  it("refuses a viewer and a stranger before any write", () => {
    for (const who of ["viewer@example.com", "stranger@elsewhere.org"]) {
      as(who);
      expect(api.saveSettings({ patch: rules(9), baseGen: 0 })).toMatchObject({ ok: false, errorKind: "forbidden" });
    }
    expect(prop("CFG_RULES")).toBeNull();
    expect(cfgGen()).toBe(0);
  });
});

describe("getSettings", () => {
  it("returns the settings, the headers per tab and an example per header, cached for 10 minutes", () => {
    as("admin@example.com");
    const open = vi.spyOn(SpreadsheetApp, "openById");
    const res = api.getSettings();
    expect(res.ok).toBe(true);
    const d = res.data!;
    expect(d.cfgGen).toBe(0);
    expect(d.headers.apps).toContain("UUID");
    expect(d.headers.ciat!.length).toBeGreaterThan(3);
    expect(d.examples.apps!["Name"]).toBeTruthy();
    expect(open).toHaveBeenCalledTimes(1);
    api.getSettings();
    expect(open).toHaveBeenCalledTimes(1);
    fakes().advance(11 * 60 * 1000);
    api.getSettings();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("still answers when the Sheet is unreachable, with no headers", () => {
    as("admin@example.com");
    fakes().setSourceAccess(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(api.getSettings().data).toMatchObject({ headers: {}, examples: {} });
  });

  it("is refused for a viewer", () => {
    as("viewer@example.com");
    expect(api.getSettings()).toMatchObject({ ok: false, errorKind: "forbidden" });
  });
});

describe("getSettingsView on a one-tab workbook", () => {
  it("offers the workbook tabs and the inventory headers for every same-tab pillar", () => {
    const one = genOneTabWorkbook();
    fakes().loadWorkbook(one);
    PropertiesService.getScriptProperties().setProperty("CFG_SOURCE", JSON.stringify({ sheetId: one.id }));
    const v = getSettingsView();
    expect(v.tabNames).toEqual(["Inventory"]);
    expect(v.headers.apps).toContain("UUID");
    expect(v.headers.ciat).toEqual(v.headers.apps);
    expect(v.headers.plat).toEqual(v.headers.apps);
    expect(v.settings.source.tabs.aud.sameTab).toBe(true);
  });
});
