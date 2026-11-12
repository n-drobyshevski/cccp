// The Access panel's authorization, a privilege surface. Derived from sidekick
// gas_hub/test/accessAdmin.test.ts at commit 77bcf22 (see VENDOR.md): the sibling-URL cases are
// gone, the owner-only mode and the logged-change cases are added.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import { getAccess, saveAccess, saveAccessMode, saveAdmins } from "../../src/server/api";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const prop = (k: string) => PropertiesService.getScriptProperties().getProperty(k);
let log: { mock: { calls: unknown[][] } };

function as(who: string): void {
  access.__resetMemosForTest();
  fakes().setActiveUser(who);
}
const changes = () =>
  log.mock.calls.map((c: unknown[]) => { try { return JSON.parse(String(c[0])); } catch { return {}; } }).filter((j: any) => j.access === "changed");

beforeEach(() => {
  fakes().seedDefaults();
  PropertiesService.getScriptProperties().setProperty("ALLOWED_USERS", "viewer@example.com");
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the tier stops where it has to", () => {
  it("REFUSES an admin editing the admins list and leaves the property unchanged", () => {
    as("admin@example.com");
    const res = saveAdmins({ admins: "admin@example.com, sneaky@example.com" });
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("forbidden");
    expect(prop("ALLOWED_ADMINS")).toBe("admin@example.com");
  });
  it("REFUSES an admin changing the access mode and leaves the property unchanged", () => {
    as("admin@example.com");
    expect(saveAccessMode({ mode: "org" }).ok).toBe(false);
    expect(prop("ACCESS_MODE")).toBeNull();
  });
  it("lets the owner edit the admins list, and logs the change", () => {
    as("owner@example.com");
    expect(saveAdmins({ admins: "admin@example.com, second@example.com" }).ok).toBe(true);
    expect(prop("ALLOWED_ADMINS")).toBe("admin@example.com, second@example.com");
    expect(changes()).toEqual([
      { access: "changed", what: "admins", actor: "owner@example.com", added: ["second@example.com"], removed: [] },
    ]);
  });
  it("lets the owner log a mode change", () => {
    as("owner@example.com");
    expect(saveAccessMode({ mode: "org" }).ok).toBe(true);
    expect(log.mock.calls.some((c: unknown[]) => String(c[0]).includes('"access":"mode"'))).toBe(true);
  });
  it("lets an admin edit the people list, and logs the actor", () => {
    as("admin@example.com");
    const res = saveAccess({ users: "viewer@example.com, newperson@example.com" });
    expect(res.ok).toBe(true);
    expect(prop("ALLOWED_USERS")).toContain("newperson@example.com");
    expect(changes()[0]).toMatchObject({ what: "users", actor: "admin@example.com", added: ["owner@example.com", "newperson@example.com"] });
  });
  it("REFUSES a viewer calling saveAccess, and the property is unchanged", () => {
    as("viewer@example.com");
    const res = saveAccess({ users: "viewer@example.com, friend@example.com" });
    expect(res).toMatchObject({ ok: false, errorKind: "forbidden" });
    expect(saveAdmins({ admins: "viewer@example.com" }).ok).toBe(false);
    expect(prop("ALLOWED_USERS")).toBe("viewer@example.com");
    expect(prop("ALLOWED_ADMINS")).toBe("admin@example.com");
  });
  it("refuses an org-mode caller and a stranger", () => {
    as("owner@example.com");
    saveAccessMode({ mode: "org" });
    as("orgperson@example.com");
    expect(saveAccess({ users: "orgperson@example.com" }).ok).toBe(false);
    as("stranger@other.org");
    expect(saveAccess({ users: "stranger@other.org" }).ok).toBe(false);
    expect(prop("ALLOWED_USERS")).toBe("viewer@example.com");
  });
});

describe("getAccess gives the roster to nobody who cannot edit it", () => {
  it("hands a viewer no roster, no owner and no addresses", () => {
    as("viewer@example.com");
    const data = getAccess().data as Record<string, unknown>;
    expect(data.canEditUsers).toBe(false);
    expect(data.users).toBeUndefined();
    expect(data.admins).toBeUndefined();
    expect(data.owner).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("@");
  });
  it("gives an admin the roster but not the power to promote", () => {
    as("admin@example.com");
    const data = getAccess().data as Record<string, unknown>;
    expect(data).toMatchObject({ canEditUsers: true, canEditAdmins: false, canEditMode: false });
    expect(data.users).toBeTruthy();
  });
  it("gives the owner everything", () => {
    as("owner@example.com");
    expect(getAccess().data).toMatchObject({
      canEditUsers: true, canEditAdmins: true, canEditMode: true, domain: "example.com", owner: "owner@example.com",
    });
  });
});

describe("a save cannot strand the owner or store junk", () => {
  it("keeps the owner in the list even when the save omits them", () => {
    as("owner@example.com");
    saveAccess({ users: "someone@example.com" });
    expect(prop("ALLOWED_USERS")).toContain("owner@example.com");
  });
  it("rejects an entry that is not an address and writes nothing", () => {
    as("owner@example.com");
    const res = saveAccess({ users: "fine@example.com, notanemail" });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("notanemail");
    expect(prop("ALLOWED_USERS")).toBe("viewer@example.com");
  });
  it("rejects a list too large for the property before writing it", () => {
    as("owner@example.com");
    const many = Array.from({ length: 400 }, (_, i) => `person${i}@averylongdomainname.example.com`);
    expect(String(saveAccess({ users: many.join(", ") }).error)).toMatch(/too long|Too many/);
  });
  it("accepts a list in any pasted shape", () => {
    as("owner@example.com");
    expect(saveAccess({ users: "A@x.com\nb@x.com; c@x.com, d@x.com" }).ok).toBe(true);
    expect(prop("ALLOWED_USERS")).toContain("a@x.com");
    expect(prop("ALLOWED_USERS")).toContain("d@x.com");
  });
});

describe("concurrent edits (review fix)", () => {
  it("refuses a whole-list write based on a list that has since changed", () => {
    as("owner@example.com");
    const base = (getAccess().data as { users: string[] }).users.join(", ");
    expect(saveAccess({ users: base + ", bob@example.com", base }).ok).toBe(true);
    const stale = saveAccess({ users: base + ", alice@example.com", base });
    expect(stale.ok).toBe(false);
    expect(stale.errorKind).toBe("conflict");
    expect(prop("ALLOWED_USERS")).toContain("bob@example.com");
    expect(prop("ALLOWED_USERS")).not.toContain("alice@example.com");
  });
  it("does not count the owner, which the panel shows apart from the list", () => {
    as("owner@example.com");
    expect(saveAccess({ users: "viewer@example.com, c@example.com", base: "viewer@example.com" }).ok).toBe(true);
  });
  it("refuses a stale admins write the same way", () => {
    as("owner@example.com");
    const base = (getAccess().data as { admins: string[] }).admins.join(", ");
    expect(saveAdmins({ admins: base + ", a2@example.com", base }).ok).toBe(true);
    expect(saveAdmins({ admins: base + ", a3@example.com", base })).toMatchObject({ ok: false, errorKind: "conflict" });
  });
});
