// The endpoint role table and the gate in run().
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportedNames } from "../../build/guards.mjs";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { ENDPOINT_ROLES, requireRole, requiredRole, roleAllows } from "../../src/server/roles";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const API_SRC = readFileSync(new URL("../../src/server/api.ts", import.meta.url), "utf8");
const exported = exportedNames(API_SRC);

function as(who: string): void {
  access.__resetMemosForTest();
  fakes().setActiveUser(who);
}

beforeEach(() => {
  fakes().seedDefaults();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("ENDPOINT_ROLES", () => {
  it("classifies every export of api.ts (fails on an unclassified one)", () => {
    expect(exported.length).toBeGreaterThan(0);
    const unclassified = exported.filter((n) => requiredRole(n) === undefined);
    expect(unclassified, "unclassified api.ts exports").toEqual([]);
  });
  it("matches the architecture table", () => {
    const by = (r: string) => Object.entries(ENDPOINT_ROLES).filter(([, v]) => v === r).map(([k]) => k).sort();
    expect(by("viewer")).toEqual(["bootstrap", "exportToSheet", "getAccess", "getRegister"]);
    expect(by("admin")).toEqual([
      "deleteSharedView", "getDiagnostics", "getSettings", "reloadData", "saveAccess", "saveSettings", "saveSharedView",
    ]);
    expect(by("owner")).toEqual(["probeSource", "saveAccessMode", "saveAdmins"]);
  });
  it("is fail closed for names it does not know, including inherited ones", () => {
    as("owner@example.com");
    for (const n of ["nope", "toString", "__proto__", "constructor"]) {
      expect(requiredRole(n)).toBeUndefined();
      expect(requireRole(n)).toMatchObject({ ok: false, errorKind: "forbidden" });
    }
  });
});

describe("roleAllows", () => {
  it("ranks viewer < admin < owner and denies a null role", () => {
    expect(roleAllows("viewer", "viewer")).toBe(true);
    expect(roleAllows("viewer", "admin")).toBe(false);
    expect(roleAllows("admin", "viewer")).toBe(true);
    expect(roleAllows("admin", "owner")).toBe(false);
    expect(roleAllows("owner", "owner")).toBe(true);
    expect(roleAllows(null, "viewer")).toBe(false);
  });
});

describe("the gate in run()", () => {
  it("a refused call never reaches setProperty", () => {
    const store = PropertiesService.getScriptProperties();
    const set = vi.spyOn(store, "setProperty");
    const del = vi.spyOn(store, "deleteProperty");
    const calls: Array<() => unknown> = [
      () => api.saveAdmins({ admins: "x@example.com" }),
      () => api.saveAccessMode({ mode: "org" }),
      () => api.saveAccess({ users: "x@example.com" }),
    ];
    for (const who of ["viewer@example.com", "stranger@example.com", ""]) {
      as(who);
      for (const f of calls) expect(f()).toMatchObject({ ok: false, errorKind: "forbidden" });
    }
    as("admin@example.com");
    for (const f of [calls[0]!, calls[1]!]) expect(f()).toMatchObject({ ok: false, errorKind: "forbidden" });
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
  it("refuses an unidentified caller on a viewer endpoint", () => {
    as("");
    expect(api.bootstrap()).toMatchObject({ ok: false, errorKind: "forbidden" });
    as("viewer@example.com");
    expect(api.bootstrap().ok).toBe(true);
  });
  it("records no refusal or input-validation error in the error log", async () => {
    const { recentErrors } = await import("../../src/server/errors");
    as("viewer@example.com");
    api.saveAccess({ users: "x@example.com" });
    expect(recentErrors()).toEqual([]);
    as("owner@example.com");
    api.saveAccess({ users: "notanemail" });
    expect(api.saveAccess({ users: "notanemail" })).toMatchObject({ ok: false, errorKind: "error" });
    expect(recentErrors()).toEqual([]);
  });
  it("keeps an ApiError's kind (busy, conflict) and does not log it", async () => {
    const { ApiError, recentErrors } = await import("../../src/server/errors");
    expect(new ApiError("conflict", "stale").kind).toBe("conflict");
    expect(recentErrors()).toEqual([]);
  });
});
