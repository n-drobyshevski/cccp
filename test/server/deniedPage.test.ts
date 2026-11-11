// The denied page, the include guard and the editor-run setup() gate, through entry.js.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import { deniedHtml } from "../../src/server/access";
import { setup } from "../../src/server/setup";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const ENTRY = readFileSync(new URL("../../src/gas/entry.js", import.meta.url), "utf8");
const prop = (k: string) => PropertiesService.getScriptProperties().getProperty(k);

function as(who: string): void {
  access.__resetMemosForTest();
  fakes().setActiveUser(who);
}

beforeEach(() => {
  fakes().seedDefaults();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const D = { allowed: false, email: "stranger@example.com", reason: "not-listed" as const };

describe("deniedHtml", () => {
  it("names the address it saw, escaped", () => {
    const html = deniedHtml({ allowed: false, email: 'a<b>&"@x.com', reason: "not-listed" });
    expect(html).not.toContain("<b>");
    expect(html).toContain("a&lt;b&gt;&amp;&quot;@x.com");
  });
  it("names the owner as a mailto with a subject, and no roster or property name", () => {
    const html = deniedHtml(D, null, "owner@example.com");
    expect(html).toContain("mailto:owner@example.com");
    expect(html).toContain("subject=");
    for (const s of ["viewer@example.com", "admin@example.com", "ALLOWED_USERS", "ALLOWED_ADMINS", "ACCESS_MODE"]) {
      expect(html).not.toContain(s);
    }
    expect(html).toContain("CCCP");
  });
  it("never renders a contact line with nobody in it", () => {
    for (const c of [undefined, null, "", "   "]) {
      const html = deniedHtml(D, null, c);
      expect(html).not.toContain("mailto:");
      expect(html).toContain("ask whoever runs this dashboard");
    }
  });
  it("explains the domain requirement when it saw no address", () => {
    expect(deniedHtml({ allowed: false, email: "", reason: "anonymous" })).toMatch(/Workspace domain/);
  });
  it("offers the account switcher only with a URL", () => {
    expect(deniedHtml(D, null)).not.toContain("Switch Google account");
    expect(deniedHtml(D, "https://accounts.google.com/AccountChooser")).toContain("Switch Google account");
  });
});

describe("deniedPage as served", () => {
  it("is null for an allowed caller", () => {
    as("viewer@example.com");
    expect(access.deniedPage()).toBeNull();
  });
  it("is a page naming the address and the owner mailto, with no roster, for a denied one", () => {
    as("stranger@example.com");
    const html = access.deniedPage()!.getContent();
    expect(html).toContain("stranger@example.com");
    expect(html).toContain("mailto:owner@example.com");
    expect(html).toContain("subject=");
    expect(html).not.toContain("viewer@example.com");
    expect(html).not.toContain("admin@example.com");
    expect(html).toContain("Switch Google account");
  });
  it("is served for an unidentified caller too", () => {
    as("");
    expect(access.deniedPage()).not.toBeNull();
  });
});

function loadEntry(server: Record<string, unknown>) {
  const ctx: Record<string, any> = { Server: server, console: { log() {} }, Date };
  runInNewContext(ENTRY, ctx);
  return ctx;
}

describe("entry.js guards", () => {
  const fakeServer = () => ({
    access,
    doGet: () => "APP",
    include: (f: string) => "FILE:" + f,
    setup,
    api: {},
  });
  it("include returns '' when denied and the file when allowed", () => {
    const ctx = loadEntry(fakeServer());
    as("stranger@example.com");
    expect(ctx.include("index")).toBe("");
    as("");
    expect(ctx.include("index")).toBe("");
    as("viewer@example.com");
    expect(ctx.include("index")).toBe("FILE:index");
  });
  it("doGet serves the denied page, never the app, to a denied caller", () => {
    const ctx = loadEntry(fakeServer());
    as("stranger@example.com");
    const out = ctx.doGet({});
    expect(out).not.toBe("APP");
    expect(out.getContent()).toContain("mailto:owner@example.com");
    as("viewer@example.com");
    expect(ctx.doGet({})).toBe("APP");
  });
  it("setup() refuses a stranger, a viewer and an admin, and writes nothing", () => {
    const ctx = loadEntry(fakeServer());
    const before = JSON.stringify(PropertiesService.getScriptProperties().getProperties());
    for (const who of ["stranger@example.com", "", "viewer@example.com", "admin@example.com"]) {
      as(who);
      expect(() => ctx.setup("1AbCdEfGhIjKlMnOpQ")).toThrow();
    }
    expect(JSON.stringify(PropertiesService.getScriptProperties().getProperties())).toBe(before);
  });
  it("setup() runs for the owner", () => {
    const ctx = loadEntry(fakeServer());
    as("owner@example.com");
    expect(ctx.setup()).toContain("owner@example.com");
  });
});

describe("setup", () => {
  const snap = () => JSON.stringify(PropertiesService.getScriptProperties().getProperties());
  it("seeds the owner, the default sections and the Sheet, for the owner only", () => {
    fakes().reset();
    as("owner@example.com");
    const out = setup("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrSt/edit");
    expect(out).toContain("1AbCdEfGhIjKlMnOpQrSt");
    expect(prop("ALLOWED_USERS")).toBe("owner@example.com");
    for (const k of ["CFG_SOURCE", "CFG_FIELDS", "CFG_RULES", "CFG_DISPLAY"]) expect(prop(k)).not.toBeNull();
    expect(JSON.parse(prop("CFG_SOURCE")!).sheetId).toBe("1AbCdEfGhIjKlMnOpQrSt");
  });
  it("is idempotent and keeps what is already stored", () => {
    fakes().reset();
    as("owner@example.com");
    const url = "1AbCdEfGhIjKlMnOpQrSt";
    setup(url);
    PropertiesService.getScriptProperties().setProperty("ALLOWED_USERS", "owner@example.com, keep@example.com");
    const a = snap();
    setup(url);
    expect(snap()).toBe(a);
    setup();
    expect(snap()).toBe(a);
    expect(prop("ALLOWED_USERS")).toContain("keep@example.com");
  });
  it("refuses a non-owner directly, not only through entry.js", () => {
    for (const who of ["admin@example.com", "viewer@example.com", "stranger@example.com"]) {
      as(who);
      expect(() => setup()).toThrow();
    }
  });
  it("rejects something that is not a Sheet link", () => {
    fakes().reset();
    as("owner@example.com");
    expect(() => setup("not a sheet!")).toThrow(/Sheet/);
  });
});
