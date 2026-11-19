// The access decision table and the guards. Derived from sidekick gas/test/access.test.ts at
// commit 77bcf22 (see VENDOR.md), with the org-mode rows added. The decision is the kit's
// decideAccess; the table is kept here as CCCP's own statement of the rules, fed through the same
// parsing of the stored lists that the bound access object uses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, parseAccessMode, parseAddressList, validateAddresses } from "@gas-kit/server";
import { access, __resetMemosForTest } from "../../src/server/access";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const props = () => PropertiesService.getScriptProperties();

beforeEach(() => {
  __resetMemosForTest();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const OWNER = "owner@example.com";

/** The decision as the bound access object makes it from the stored property values. */
const decide = (active: string | null, owner: string | null, raw: string | null, adminsRaw: string | null = null, modeRaw: string | null = null) =>
  decideAccess({ active, owner, users: parseAddressList(raw), admins: parseAddressList(adminsRaw), mode: parseAccessMode(modeRaw) });

describe("parseAddressList", () => {
  it("splits on commas, semicolons, newlines and spaces alike", () => {
    expect(parseAddressList("a@x.com, b@x.com;c@x.com\nd@x.com e@x.com")).toEqual([
      "a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com",
    ]);
  });
  it("trims, lowercases and dedupes", () => {
    expect(parseAddressList("  A@X.com , a@x.COM\n\n  b@x.com  ")).toEqual(["a@x.com", "b@x.com"]);
  });
  it("reads nothing as an empty list rather than a wildcard", () => {
    for (const raw of [null, "", "   ", " , ; \n ,"]) expect(parseAddressList(raw)).toEqual([]);
  });
});

describe("decide: the hub rows", () => {
  it("denies a caller it cannot identify", () => {
    for (const active of [null, "", "   "]) {
      const d = decide(active, OWNER, "a@x.com");
      expect(d).toEqual({ allowed: false, role: null, email: "", reason: "anonymous" });
    }
  });
  it("still denies when the active and owner addresses are both blank", () => {
    const d = decide("", "", "a@x.com");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("anonymous");
  });
  it("denies an identified caller who is not listed, and echoes the address", () => {
    const d = decide("stranger@example.com", OWNER, "a@x.com, b@x.com");
    expect(d).toEqual({ allowed: false, role: null, email: "stranger@example.com", reason: "not-listed" });
  });
  it("denies a domain user when the lists are unset", () => {
    expect(decide("someone@example.com", OWNER, null).allowed).toBe(false);
    expect(decide("someone@example.com", OWNER, null, null, null).allowed).toBe(false);
  });
  it("always admits the owner: no list, malformed list, case and padding", () => {
    expect(decide(OWNER, OWNER, null)).toMatchObject({ allowed: true, reason: "owner" });
    expect(decide(OWNER, OWNER, " , ; ").allowed).toBe(true);
    expect(decide("  Owner@Example.com ", OWNER, null).allowed).toBe(true);
    expect(decide(OWNER, OWNER, null, null, "garbage").allowed).toBe(true);
  });
  it("admits an admin by being an admin, a listed caller by being listed", () => {
    expect(decide("adm@example.com", OWNER, "", "adm@example.com").reason).toBe("admin");
    expect(decide("Listed@Example.com", OWNER, "listed@example.com").reason).toBe("listed");
  });
  it("puts owner before admin before listed", () => {
    expect(decide(OWNER, OWNER, OWNER, OWNER).reason).toBe("owner");
    expect(decide("a@example.com", OWNER, "a@example.com", "a@example.com").reason).toBe("admin");
  });
});

describe("decide: org rows", () => {
  const org = (active: string | null, owner: string | null = OWNER, mode: string | null = "org") =>
    decide(active, owner, null, null, mode);
  it("admits the same domain, case-insensitively", () => {
    expect(org("anyone@example.com")).toEqual({ allowed: true, role: "viewer", email: "anyone@example.com", reason: "org" });
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
    expect(decide("anyone@example.com", OWNER, null, null, "org").reason).toBe("org");
  });
  it("lets lists still work in org mode and keeps admin ahead of org", () => {
    expect(decide("adm@example.com", OWNER, "", "adm@example.com", "org").reason).toBe("admin");
    expect(decide("u@other.org", OWNER, "u@other.org", null, "org").reason).toBe("listed");
  });
});

describe("check and the guards", () => {
  it("decides from Session and the Script Properties, once per execution", () => {
    fakes().setActiveUser("viewer@example.com");
    props().setProperty("ALLOWED_USERS", "viewer@example.com");
    expect(access.decide().allowed).toBe(true);
    // The kit reads the store once per execution through getProperties(), which the fakes do not
    // count, so the once-per-execution claim is watched on that read (the caller is asked again
    // each time: the memo is keyed to the active address).
    const stored = vi.spyOn(props(), "getProperties");
    const getProperty = vi.spyOn(props(), "getProperty");
    access.decide();
    access.decide();
    expect(stored).not.toHaveBeenCalled();
    expect(getProperty).not.toHaveBeenCalled();
  });
  it("reads ACCESS_MODE from the property", () => {
    fakes().setActiveUser("anyone@example.com");
    props().setProperty("ACCESS_MODE", "org");
    expect(access.decide().reason).toBe("org");
    expect(access.role()).toBe("viewer");
  });
  it("denyResult is null when allowed and a forbidden envelope with the owner contact when not", () => {
    fakes().setActiveUser("stranger@example.com");
    const d = access.denyResult("bootstrap")!;
    expect(d).toMatchObject({ ok: false, errorKind: "forbidden", contact: OWNER });
    expect(d.contactUrl).toContain("mailto:" + OWNER);
    expect(d.error).not.toContain(OWNER);
    __resetMemosForTest();
    fakes().setActiveUser(OWNER);
    expect(access.denyResult("bootstrap")).toBeNull();
  });
  it("names the owner to a caller whose address could not be read, as it always did (the deployment is DOMAIN)", () => {
    fakes().setActiveUser("");
    const d = access.denyResult("bootstrap")!;
    expect(d).toMatchObject({ ok: false, errorKind: "forbidden", contact: OWNER });
  });
  it("reads the lists in both stored forms: the delimited text CCCP always wrote and a JSON array", () => {
    props().setProperty("ALLOWED_USERS", "old@example.com, older@example.com");
    props().setProperty("ALLOWED_ADMINS", JSON.stringify(["boss@example.com"]));
    expect(access.currentUsers()).toEqual(["old@example.com", "older@example.com"]);
    expect(access.currentAdmins()).toEqual(["boss@example.com"]);
    fakes().setActiveUser("older@example.com");
    expect(access.decide()).toMatchObject({ allowed: true, reason: "listed", role: "viewer" });
    __resetMemosForTest();
    fakes().setActiveUser("boss@example.com");
    expect(access.decide()).toMatchObject({ allowed: true, reason: "admin", role: "admin" });
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
    fakes().seedDefaults();
    __resetMemosForTest();
    fakes().setActiveUser("admin@example.com");
    expect(() => access.assertOwner("setup")).toThrow(/owner/);
    __resetMemosForTest();
    fakes().setActiveUser(OWNER);
    expect(() => access.assertOwner("setup")).not.toThrow();
  });
  it("the predicates follow the role", () => {
    fakes().seedDefaults();
    const probe = (who: string) => {
      __resetMemosForTest();
      fakes().setActiveUser(who);
      return [access.role(), access.canEditSettings(), access.canEditAdmins(), access.canEditMode(), access.isOwner()];
    };
    expect(probe(OWNER)).toEqual(["owner", true, true, true, true]);
    expect(probe("admin@example.com")).toEqual(["admin", true, false, false, false]);
    expect(probe("viewer@example.com")).toEqual(["viewer", false, false, false, false]);
    expect(probe("nobody@example.com")).toEqual([null, false, false, false, false]);
  });
});

describe("validateAddresses", () => {
  it("refuses a payload with no list, so a misspelled field cannot empty the people list", () => {
    expect(() => validateAddresses(undefined)).toThrow(/No list was sent/);
    expect(() => validateAddresses(null)).toThrow(/No list was sent/);
    expect(validateAddresses([])).toEqual([]);
    expect(validateAddresses("")).toEqual([]);
  });
  it("refuses an address that is not a plain ASCII one", () => {
    expect(() => validateAddresses("a@x")).toThrow(/Not an email address/);
    expect(() => validateAddresses("ünï@example.com")).toThrow(/Not an email address/);
  });
  it("rejects an entry with no @ and refuses over-long lists", () => {
    expect(() => validateAddresses("a@x.com, nope")).toThrow(/nope/);
    const many = Array.from({ length: 400 }, (_, i) => `person${i}@averylongdomainname.example.com`);
    expect(() => validateAddresses(many)).toThrow(/too long|Too many/);
  });
});

describe("parseAccessMode", () => {
  it("is org only for exactly 'org'", () => {
    expect(parseAccessMode("org")).toBe("org");
    for (const v of [null, "", "list", "Org", "org "]) expect(parseAccessMode(v)).toBe("list");
    // Unset takes the app's default, which is list here.
    expect(parseAccessMode(null, "list")).toBe("list");
  });
});
