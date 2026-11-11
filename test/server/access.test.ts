// The access decision table and the guards. Derived from sidekick gas/test/access.test.ts at
// commit 77bcf22 (see VENDOR.md), with the org-mode rows added.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const props = () => PropertiesService.getScriptProperties();

beforeEach(() => {
  access.__resetMemosForTest();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const OWNER = "owner@example.com";

describe("parseAllowlist", () => {
  it("splits on commas, semicolons, newlines and spaces alike", () => {
    expect(access.parseAllowlist("a@x.com, b@x.com;c@x.com\nd@x.com e@x.com")).toEqual([
      "a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com",
    ]);
  });
  it("trims, lowercases and dedupes", () => {
    expect(access.parseAllowlist("  A@X.com , a@x.COM\n\n  b@x.com  ")).toEqual(["a@x.com", "b@x.com"]);
  });
  it("reads nothing as an empty list rather than a wildcard", () => {
    for (const raw of [null, "", "   ", " , ; \n ,"]) expect(access.parseAllowlist(raw)).toEqual([]);
  });
});

describe("decide: the hub rows", () => {
  it("denies a caller it cannot identify", () => {
    for (const active of [null, "", "   "]) {
      const d = access.decide(active, OWNER, "a@x.com");
      expect(d).toEqual({ allowed: false, email: "", reason: "anonymous" });
    }
  });
  it("still denies when the active and owner addresses are both blank", () => {
    const d = access.decide("", "", "a@x.com");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("anonymous");
  });
  it("denies an identified caller who is not listed, and echoes the address", () => {
    const d = access.decide("stranger@example.com", OWNER, "a@x.com, b@x.com");
    expect(d).toEqual({ allowed: false, email: "stranger@example.com", reason: "not-listed" });
  });
  it("denies a domain user when the lists are unset", () => {
    expect(access.decide("someone@example.com", OWNER, null).allowed).toBe(false);
    expect(access.decide("someone@example.com", OWNER, null, null, null).allowed).toBe(false);
  });
  it("always admits the owner: no list, malformed list, case and padding", () => {
    expect(access.decide(OWNER, OWNER, null)).toMatchObject({ allowed: true, reason: "owner" });
    expect(access.decide(OWNER, OWNER, " , ; ").allowed).toBe(true);
    expect(access.decide("  Owner@Example.com ", OWNER, null).allowed).toBe(true);
    expect(access.decide(OWNER, OWNER, null, null, "garbage").allowed).toBe(true);
  });
  it("admits an admin by being an admin, a listed caller by being listed", () => {
    expect(access.decide("adm@example.com", OWNER, "", "adm@example.com").reason).toBe("admin");
    expect(access.decide("Listed@Example.com", OWNER, "listed@example.com").reason).toBe("listed");
  });
  it("puts owner before admin before listed", () => {
    expect(access.decide(OWNER, OWNER, OWNER, OWNER).reason).toBe("owner");
    expect(access.decide("a@example.com", OWNER, "a@example.com", "a@example.com").reason).toBe("admin");
  });
});

describe("decide: org rows", () => {
  const org = (active: string | null, owner: string | null = OWNER, mode: string | null = "org") =>
    access.decide(active, owner, null, null, mode);
  it("admits the same domain, case-insensitively", () => {
    expect(org("anyone@example.com")).toEqual({ allowed: true, email: "anyone@example.com", reason: "org" });
    expect(org("Any.One@EXAMPLE.com").reason).toBe("org");
  });
  it("denies another domain, a lookalike and a subdomain", () => {
    for (const e of ["x@other.org", "x@example.com.evil.org", "x@mail.example.com", "x@notexample.com"]) {
      expect(org(e), e).toMatchObject({ allowed: false, reason: "not-listed" });
    }
  });
  it("denies an empty email as anonymous", () => {
    expect(org("")).toMatchObject({ allowed: false, reason: "anonymous" });
    expect(org(null)).toMatchObject({ allowed: false, reason: "anonymous" });
  });
  it("denies an address with no usable domain", () => {
    for (const e of ["nodomain", "x@", "@example.com", "a@b@example.com"]) {
      expect(org(e, OWNER).allowed, e).toBe(false);
    }
  });
  it("denies everyone but the owner when the owner's domain is empty", () => {
    for (const owner of [null, "", "owner", "owner@"]) {
      expect(org("x@example.com", owner).allowed, String(owner)).toBe(false);
      expect(org("x", owner).allowed).toBe(false);
      expect(org("x@", owner).allowed).toBe(false);
    }
  });
  it("treats a malformed mode as list", () => {
    for (const mode of [null, "", "ORG", " org", "org ", "organization", "list", "all", "true"]) {
      expect(org("anyone@example.com", OWNER, mode).allowed, String(mode)).toBe(false);
    }
  });
  it("makes no one an admin: org users are viewers", () => {
    expect(access.decide("anyone@example.com", OWNER, null, null, "org").reason).toBe("org");
  });
  it("lets lists still work in org mode and keeps admin ahead of org", () => {
    expect(access.decide("adm@example.com", OWNER, "", "adm@example.com", "org").reason).toBe("admin");
    expect(access.decide("u@other.org", OWNER, "u@other.org", null, "org").reason).toBe("listed");
  });
});

describe("check and the guards", () => {
  it("decides from Session and the Script Properties, once per execution", () => {
    fakes().setActiveUser("viewer@example.com");
    props().setProperty("ALLOWED_USERS", "viewer@example.com");
    expect(access.check().allowed).toBe(true);
    const reads = fakes().counters().propGet;
    access.check();
    access.check();
    expect(fakes().counters().propGet).toBe(reads);
    expect(reads).toBeGreaterThan(0);
  });
  it("reads ACCESS_MODE from the property", () => {
    fakes().setActiveUser("anyone@example.com");
    props().setProperty("ACCESS_MODE", "org");
    expect(access.check().reason).toBe("org");
    expect(access.role()).toBe("viewer");
  });
  it("denyResult is null when allowed and a forbidden envelope with the owner contact when not", () => {
    fakes().setActiveUser("stranger@example.com");
    const d = access.denyResult("bootstrap")!;
    expect(d).toMatchObject({ ok: false, errorKind: "forbidden", contact: OWNER });
    expect(d.contactUrl).toContain("mailto:" + OWNER);
    expect(d.error).not.toContain(OWNER);
    access.__resetMemosForTest();
    fakes().setActiveUser(OWNER);
    expect(access.denyResult("bootstrap")).toBeNull();
  });
  it("omits the contact when the owner cannot be resolved", () => {
    fakes().setActiveUser("stranger@example.com");
    fakes().setEffectiveUser("");
    const d = access.denyResult("bootstrap")!;
    expect(d.contact).toBeUndefined();
    expect(d.contactUrl).toBeUndefined();
  });
  it("assertAllowed throws for a denied caller; assertOwner for a non-owner", () => {
    fakes().setActiveUser("stranger@example.com");
    expect(() => access.assertAllowed("setup")).toThrow();
    access.__resetMemosForTest();
    fakes().setActiveUser("admin@example.com");
    fakes().seedDefaults();
    expect(() => access.assertOwner("setup")).toThrow(/owner/);
    access.__resetMemosForTest();
    fakes().setActiveUser(OWNER);
    expect(() => access.assertOwner("setup")).not.toThrow();
  });
  it("the predicates follow the role", () => {
    fakes().seedDefaults();
    const probe = (who: string) => {
      access.__resetMemosForTest();
      fakes().setActiveUser(who);
      return [access.role(), access.canEditSettings(), access.canEditAdmins(), access.canEditMode(), access.canEditSource()];
    };
    expect(probe(OWNER)).toEqual(["owner", true, true, true, true]);
    expect(probe("admin@example.com")).toEqual(["admin", true, false, false, false]);
    expect(probe("viewer@example.com")).toEqual(["viewer", false, false, false, false]);
    expect(probe("nobody@example.com")).toEqual([null, false, false, false, false]);
  });
});

describe("validateAddresses", () => {
  it("rejects an entry with no @ and refuses over-long lists", () => {
    expect(() => access.validateAddresses("a@x.com, nope")).toThrow(/nope/);
    const many = Array.from({ length: 400 }, (_, i) => `person${i}@averylongdomainname.example.com`);
    expect(() => access.validateAddresses(many)).toThrow(/too long|Too many/);
  });
});

describe("parseAccessMode", () => {
  it("is org only for exactly 'org'", () => {
    expect(access.parseAccessMode("org")).toBe("org");
    for (const v of [null, "", "list", "Org", "org "]) expect(access.parseAccessMode(v)).toBe("list");
  });
});
