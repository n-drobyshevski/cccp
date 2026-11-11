// saveAccessMode and the end-to-end effect of the mode on who gets in.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import { getAccess, saveAccessMode } from "../../src/server/api";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const prop = (k: string) => PropertiesService.getScriptProperties().getProperty(k);
let log: { mock: { calls: unknown[][] } };

function as(who: string): void {
  access.__resetMemosForTest();
  fakes().setActiveUser(who);
}

beforeEach(() => {
  fakes().seedDefaults();
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("saveAccessMode", () => {
  it("lets the owner switch to org and back, and logs before and after", () => {
    as("owner@example.com");
    expect(saveAccessMode({ mode: "org" })).toEqual({ ok: true, data: { mode: "org" } });
    expect(prop("ACCESS_MODE")).toBe("org");
    const lines = log.mock.calls.map((c: unknown[]) => String(c[0]));
    const entry = lines.map((l: string) => JSON.parse(l)).find((j: any) => j.access === "mode");
    expect(entry).toEqual({ access: "mode", actor: "owner@example.com", before: "list", after: "org" });
    expect(saveAccessMode({ mode: "list" }).ok).toBe(true);
    expect(prop("ACCESS_MODE")).toBe("list");
  });
  it("refuses anything but org or list, and writes nothing", () => {
    as("owner@example.com");
    for (const mode of ["ORG", "all", "", null, undefined, 1, {}]) {
      const r = saveAccessMode({ mode });
      expect(r.ok, String(mode)).toBe(false);
      expect(prop("ACCESS_MODE")).toBeNull();
    }
    expect(saveAccessMode().ok).toBe(false);
  });
  it("refuses an admin, a viewer and a stranger, and leaves the property alone", () => {
    for (const who of ["admin@example.com", "viewer@example.com", "stranger@example.com"]) {
      as(who);
      const r = saveAccessMode({ mode: "org" });
      expect(r, who).toMatchObject({ ok: false, errorKind: "forbidden" });
      expect(prop("ACCESS_MODE"), who).toBeNull();
    }
  });
  it("changes who gets in: a same-domain stranger is admitted in org mode only", () => {
    as("anyone@example.com");
    expect(access.check().allowed).toBe(false);
    as("owner@example.com");
    saveAccessMode({ mode: "org" });
    as("anyone@example.com");
    expect(access.check()).toMatchObject({ allowed: true, reason: "org" });
    expect(access.role()).toBe("viewer");
    expect(getAccess().data).toEqual({ canEditUsers: false, canEditAdmins: false, canEditMode: false });
    as("owner@example.com");
    saveAccessMode({ mode: "list" });
    as("anyone@example.com");
    expect(access.check().allowed).toBe(false);
  });
  it("shows the mode to admins and the owner only", () => {
    as("admin@example.com");
    expect(getAccess().data).toMatchObject({ mode: "list", canEditMode: false });
    as("owner@example.com");
    expect(getAccess().data).toMatchObject({ mode: "list", canEditMode: true });
    as("viewer@example.com");
    expect(JSON.stringify(getAccess().data)).not.toContain("list");
  });
});
