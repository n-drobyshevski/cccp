import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("probeSource", () => {
  it("lists every tab with its row count and headers, for the saved Sheet when no link is given", () => {
    as("owner@example.com");
    const res = api.probeSource({ url: "" });
    expect(res.ok).toBe(true);
    const names = res.data!.tabs.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Apps", "CIAT", "Audits", "DRP", "Platform"]));
    const apps = res.data!.tabs.find((t) => t.name === "Apps")!;
    expect(apps.headers).toContain("UUID");
    expect(apps.rows).toBeGreaterThan(0);
    expect(fakes().calls()).toEqual([]);
  });

  it("takes a full link, refuses text with no id, and is owner only", () => {
    as("owner@example.com");
    expect(api.probeSource({ url: "not a link" })).toMatchObject({ ok: false });
    as("admin@example.com");
    expect(api.probeSource({ url: "" })).toMatchObject({ ok: false, errorKind: "forbidden" });
  });
});
