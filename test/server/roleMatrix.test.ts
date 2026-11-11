// Every RPC, through src/gas/entry.js loaded in a node vm, as five identities. The result must
// match ENDPOINT_ROLES exactly: refused (forbidden, nothing written) below the needed role,
// not forbidden at or above it. Also: no endpoint ever reaches the source-write error.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportedNames } from "../../build/guards.mjs";
import * as server from "../../src/server/index";
import * as access from "../../src/server/access";
import { ENDPOINT_ROLES, roleAllows, type Role } from "../../src/server/roles";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const ENTRY = readFileSync(new URL("../../src/gas/entry.js", import.meta.url), "utf8");
const NAMES = exportedNames(readFileSync(new URL("../../src/server/api.ts", import.meta.url), "utf8"));

interface Identity { label: string; email: string; role: Role | null }
const IDENTITIES: Identity[] = [
  { label: "owner", email: "owner@example.com", role: "owner" },
  { label: "admin", email: "admin@example.com", role: "admin" },
  { label: "listed viewer", email: "viewer@example.com", role: "viewer" },
  { label: "stranger", email: "stranger@elsewhere.org", role: null },
  { label: "anonymous", email: "", role: null },
];

const VIEW = { name: "Matrix", scope: "shared", route: "list", state: { q: "", f: {}, sort: "n", cols: [], metric: "worst" } };
const PARAMS: Record<string, unknown> = {
  saveAccess: { users: "viewer@example.com" },
  saveAdmins: { admins: "admin@example.com" },
  saveAccessMode: { mode: "list" },
  saveSettings: { patch: { display: { theme: "dark" } }, baseGen: 0 },
  saveSharedView: { view: VIEW },
  deleteSharedView: { id: "nothere" },
  probeSource: { url: "" },
  exportToSheet: { ids: [], columns: [], title: "x" },
};

function loadEntry(): Record<string, (p: unknown) => any> {
  const ctx = vm.createContext({ console, Date, JSON, Server: server });
  vm.runInContext(ENTRY, ctx, { filename: "entry.js" });
  return ctx as unknown as Record<string, (p: unknown) => any>;
}

const props = () => JSON.stringify(Object.entries(PropertiesService.getScriptProperties().getProperties()).sort());

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the role matrix", () => {
  it("covers every export of api.ts and nothing is unclassified", () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(12);
    for (const n of NAMES) expect(Object.keys(ENDPOINT_ROLES)).toContain(n);
  });

  for (const name of NAMES) {
    describe("api_" + name, () => {
      const need = (ENDPOINT_ROLES as Record<string, Role>)[name]!;
      for (const who of IDENTITIES) {
        const allowed = roleAllows(who.role, need);
        it((allowed ? "runs for " : "is refused for ") + who.label + " (needs " + need + ")", () => {
          access.__resetMemosForTest();
          fakes().setActiveUser(who.email);
          const entry = loadEntry();
          expect(typeof entry["api_" + name]).toBe("function");
          const before = props();
          const res = entry["api_" + name]!(PARAMS[name] ?? {});
          expect(typeof res.ok).toBe("boolean");
          if (allowed) {
            expect(res.errorKind, JSON.stringify(res)).not.toBe("forbidden");
            expect(String(res.error ?? "")).not.toContain(fakes().WRITE_ERROR);
          } else {
            expect(res).toMatchObject({ ok: false, errorKind: "forbidden" });
            expect(props()).toBe(before);
          }
        });
      }
    });
  }

  it("the owner's calls all succeed with sensible parameters, and none touches the source", () => {
    access.__resetMemosForTest();
    fakes().setActiveUser("owner@example.com");
    const entry = loadEntry();
    for (const name of NAMES) {
      if (name === "deleteSharedView") continue;
      const res = entry["api_" + name]!(PARAMS[name] ?? {});
      expect(res.ok, name + ": " + res.error).toBe(true);
    }
    expect(fakes().calls()).toEqual([]);
  });

  it("an admin sheetId patch is refused through entry.js and a rules patch is accepted", () => {
    access.__resetMemosForTest();
    fakes().setActiveUser("admin@example.com");
    const entry = loadEntry();
    const refused = entry["api_saveSettings"]!({ patch: { source: { sheetId: "someone_elses_sheet" } }, baseGen: 0 });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.error).toMatch(/Only the owner/);
    const ok = entry["api_saveSettings"]!({ patch: { rules: { rules: { "pl.noSso": { on: false } } } }, baseGen: 0 });
    expect(ok.ok).toBe(true);
    expect(ok.data.settings.rules.rules["pl.noSso"]).toEqual({ on: false });
  });

  it("org mode: a same-domain address is a viewer, so admin endpoints refuse it", () => {
    PropertiesService.getScriptProperties().setProperty("ACCESS_MODE", "org");
    access.__resetMemosForTest();
    fakes().setActiveUser("colleague@example.com");
    const entry = loadEntry();
    expect(entry["api_bootstrap"]!({}).ok).toBe(true);
    expect(entry["api_getRegister"]!({}).ok).toBe(true);
    for (const n of ["saveSettings", "reloadData", "getSettings", "getDiagnostics", "saveSharedView"]) {
      expect(entry["api_" + n]!(PARAMS[n] ?? {}), n).toMatchObject({ ok: false, errorKind: "forbidden" });
    }
  });
});
