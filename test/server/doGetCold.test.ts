// doGet never reads the Sheet: a cold cache serves the page with an empty boot block and the
// client asks for the bootstrap behind its splash; a warm cache inlines it as before.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { bootstrapIfWarm } from "../../src/server/bootstrap";
import { doGet } from "../../src/server/main";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  access.__resetMemosForTest();
  fakes().setActiveUser("viewer@example.com");
  fakes().setHtmlFile("index", "<main><?!= bootJson ?></main>");
});

const body = () => (doGet({} as GoogleAppsScript.Events.DoGet) as unknown as { getContent(): string }).getContent();

describe("doGet and the cold cache", () => {
  it("renders an empty boot block and never opens the Sheet on a cold cache", () => {
    fakes().clearCache();
    const open = vi.spyOn(SpreadsheetApp, "openById");
    expect(bootstrapIfWarm()).toBeNull();
    expect(body()).toBe("<main></main>");
    expect(open).not.toHaveBeenCalled();
  });

  it("inlines the bootstrap, register included, once the cache is warm", () => {
    expect(api.bootstrap().ok).toBe(true);
    const open = vi.spyOn(SpreadsheetApp, "openById");
    const html = body();
    expect(open).not.toHaveBeenCalled();
    const env = JSON.parse(html.slice("<main>".length, -"</main>".length));
    expect(env.ok).toBe(true);
    expect(env.data.live.viewer.email).toBe("viewer@example.com");
    expect(env.data.register).toBeDefined();
    expect(env.data.register.v).toBe(api.getRegister().data!.v);
  });

});
