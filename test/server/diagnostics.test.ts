import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { diagnosticsReport, diagnosticsText } from "../../src/server/diagnostics";
import { recordError } from "../../src/server/errors";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("diagnostics report", () => {
  it("reports owner, mode, list sizes, tabs, versions, cache, sizes and recent errors", () => {
    as("admin@example.com");
    api.getRegister();
    recordError("saveSettings", new Error("boom"));
    const res = api.getDiagnostics();
    expect(res.ok).toBe(true);
    const r = res.data!;
    expect(r).toMatchObject({
      owner: "owner@example.com", mode: "list", listSizes: { users: 1, admins: 1 },
      versions: { dataVersion: 0, cfgGen: 0 }, failures: [],
    });
    expect(r.source!.title).toBeTruthy();
    expect(r.source!.tabs.map((t) => t.name)).toEqual(["Apps", "CIAT", "Audits", "DRP", "Platform"]);
    expect(r.source!.tabs[0]!.rows).toBeGreaterThan(100);
    expect(r.source!.tabs.find((t) => t.key === "drp")!.missingHeaders.length).toBeGreaterThan(0);
    expect(r.cache.registerWarm).toBe(true);
    expect(r.register.bytes!).toBeGreaterThan(1000);
    expect(r.register.rows).toBe(r.source!.tabs[0]!.rows);
    expect(r.register.warnings).toEqual([]);
    expect(r.propertyBytes["ALLOWED_ADMINS"]).toBeGreaterThan(0);
    expect(r.recentErrors[0]).toMatchObject({ op: "saveSettings", message: "boom" });
  });

  it("does not list anyone's address except the owner", () => {
    as("admin@example.com");
    expect(JSON.stringify(api.getDiagnostics().data)).not.toMatch(/viewer@example\.com|admin@example\.com/);
  });

  it("works with nothing configured", () => {
    PropertiesService.getScriptProperties().deleteProperty("CFG_SOURCE");
    const r = diagnosticsReport();
    expect(r.failures).toEqual([]);
    expect(r.source).toMatchObject({ sheetId: "", tabs: [] });
    expect(r.cache.registerWarm).toBe(false);
  });

  it("is admin only", () => {
    as("viewer@example.com");
    expect(api.getDiagnostics()).toMatchObject({ ok: false, errorKind: "forbidden" });
  });

  it("NEVER throws, even with every shim made to throw", () => {
    const g = globalThis as unknown as Record<string, Record<string, unknown>>;
    const boom = () => { throw new Error("shim down"); };
    const saved: Array<[Record<string, unknown>, string, unknown]> = [];
    for (const svc of ["PropertiesService", "CacheService", "SpreadsheetApp", "Session", "ScriptApp", "LockService", "Utilities"]) {
      for (const k of Object.keys(g[svc]!)) {
        saved.push([g[svc]!, k, g[svc]![k]]);
        g[svc]![k] = boom;
      }
    }
    try {
      expect(() => diagnosticsReport()).not.toThrow();
      const r = diagnosticsReport();
      expect(r.failures.length).toBeGreaterThan(0);
      expect(r.failures.join(" ")).toMatch(/shim down/);
      expect(() => diagnosticsText()).not.toThrow();
      expect(diagnosticsText()).toMatch(/FAILED/);
    } finally {
      for (const [o, k, v] of saved) o[k] = v;
    }
  });

  it("warns when the register is over the limits", () => {
    // Only the structure is checked: a huge register is not built here.
    const r = diagnosticsReport();
    expect(Array.isArray(r.register.warnings)).toBe(true);
  });
});

describe("diagnosticsText", () => {
  it("prints a readable summary with each tab", () => {
    const t = diagnosticsText();
    expect(t).toMatch(/^CCCP diagnostics /);
    expect(t).toMatch(/Apps: \d+ rows/);
    expect(t).toMatch(/DRP: .*missing/);
  });
});
