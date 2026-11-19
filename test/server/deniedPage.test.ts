// The denied page (the kit card), the include guard and the editor-run setup() gate, through entry.js.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { access, __resetMemosForTest } from "../../src/server/access";
import { setup } from "../../src/server/setup";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();
const ENTRY = readFileSync(new URL("../../src/gas/entry.js", import.meta.url), "utf8");
const prop = (k: string) => PropertiesService.getScriptProperties().getProperty(k);

function as(who: string): void {
  __resetMemosForTest();
  fakes().setActiveUser(who);
}

beforeEach(() => {
  fakes().seedDefaults();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("deniedPage as served", () => {
  it("is null for an allowed caller", () => {
    as("viewer@example.com");
    expect(access.deniedPage()).toBeNull();
  });
  it("names the address it saw, escaped, and nothing of the roster", () => {
    as('a<b>&"@x.com');
    const html = access.deniedPage()!.getContent();
    expect(html).not.toContain("<b>");
    expect(html).toContain("a&lt;b&gt;&amp;&quot;@x.com");
    for (const s of ["viewer@example.com", "admin@example.com", "ALLOWED_USERS", "ALLOWED_ADMINS", "ACCESS_MODE"]) {
      expect(html).not.toContain(s);
    }
    expect(html).toContain("CCCP");
  });
  it("names the owner to a denied caller, with the account switcher and no roster", () => {
    as("stranger@example.com");
    const html = access.deniedPage()!.getContent();
    expect(html).toContain("stranger@example.com");
    expect(html).toContain("contact owner@example.com");
    expect(html).not.toContain("viewer@example.com");
    expect(html).not.toContain("admin@example.com");
    expect(html).toContain("Switch Google account");
  });
  it("never renders a contact line with nobody in it", () => {
    as("stranger@example.com");
    fakes().setEffectiveUser("");
    const html = access.deniedPage()!.getContent();
    expect(html).not.toContain("contact ");
    expect(html).toContain("ask whoever runs this app");
  });
  it("is served for an unidentified caller too, explaining the domain requirement", () => {
    as("");
    const page = access.deniedPage();
    expect(page).not.toBeNull();
    expect(page!.getContent()).toMatch(/Workspace domain/);
  });
});

function loadEntry(server: Record<string, unknown>) {
  const ctx: Record<string, any> = { Server: server, console: { log() {} }, Date };
  runInNewContext(ENTRY, ctx);
  return ctx;
}

describe("entry.js guards", () => {
  const fakeServer = () => ({
    beginExecution() {},
    UNEXPECTED_ERROR_MESSAGE: "unexpected",
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
    expect(out.getContent()).toContain("owner@example.com");
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
    const out = ctx.setup();
    expect(out).toContain("owner@example.com");
    expect(out).toContain("CCCP diagnostics");
  });
});

describe("setup", () => {
  // The diagnostics in the report may log a source error; the error log is not seeded state.
  const snap = () => { const { RECENT_ERRORS: _e, ...rest } = PropertiesService.getScriptProperties().getProperties(); return JSON.stringify(rest); };
  it("seeds the owner, the default sections and the Sheet, for the owner only", () => {
    fakes().reset();
    as("owner@example.com");
    const out = setup("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrSt/edit");
    expect(out).toContain("1AbCdEfGhIjKlMnOpQrSt");
    expect(JSON.parse(prop("ALLOWED_USERS")!)).toEqual(["owner@example.com"]);
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
