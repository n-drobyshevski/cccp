import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";

declare const window: any;

const PORT = 8791;
const BASE = "http://localhost:" + PORT;
const hasChrome = existsSync("/usr/bin/google-chrome");

describe.skipIf(!hasChrome)("dev server on :8791", () => {
  let proc: ChildProcess;
  let browser: Browser;

  beforeAll(async () => {
    proc = spawn(process.execPath, ["dev/serve.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("dev server did not start")), 15_000);
      proc.stdout!.on("data", (b) => { if (String(b).includes("localhost:" + PORT)) { clearTimeout(t); resolve(); } });
      proc.on("exit", (c) => reject(new Error("dev server exited " + c)));
    });
    browser = await chromium.launch({ channel: "chrome" });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    proc?.kill();
  });

  it("serves the page; api_bootstrap resolves via window.api_bootstrap and timedApi_, and logs timing", async () => {
    const page = await browser.newPage();
    const logs: string[] = [];
    const errors: string[] = [];
    page.on("console", (m) => { logs.push(m.text()); if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE + "/?as=viewer@example.com");
    expect(await page.evaluate(() => typeof window.api_bootstrap)).toBe("function");
    expect(await page.evaluate(() => typeof window.timedApi_)).toBe("function");

    // Through google.script.run, as the client does it. The placeholder access module refuses
    // everyone, so the envelope is the forbidden one until the access work package lands.
    const viaRun = await page.evaluate(
      () => new Promise((resolve, reject) => window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api_bootstrap({})),
    );
    expect(viaRun).toHaveProperty("ok");

    // Swap in an allowing gate to reach the timing line on the real entry.js and Server.api.
    const res = await page.evaluate(() => {
      const w = window;
      const real = w.Server;
      w.Server = { access: { denyResult: () => null }, api: real.api };
      try { return w.api_bootstrap({}); } finally { w.Server = real; }
    });
    expect(res.ok).toBe(true);
    expect(logs.some((l) => /"api":"bootstrap","ms":\d+/.test(l))).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("seeds the workbook and honours flags", async () => {
    const page = await browser.newPage();
    await page.goto(BASE + "/?as=admin@example.com&mode=org&tz=Pacific/Kiritimati");
    const out = await page.evaluate(() => {
      const w = window;
      const p = w.PropertiesService.getScriptProperties();
      const cfg = JSON.parse(p.getProperty("CFG_SOURCE"));
      const ss = w.SpreadsheetApp.openById(cfg.sheetId);
      return {
        mode: p.getProperty("ACCESS_MODE"), user: w.Session.getActiveUser().getEmail(),
        owner: w.Session.getEffectiveUser().getEmail(), rows: ss.getSheetByName("Apps").getLastRow(),
        tz: ss.getSpreadsheetTimeZone(),
      };
    });
    expect(out).toEqual({ mode: "org", user: "admin@example.com", owner: "owner@example.com", rows: 1126, tz: "Pacific/Kiritimati" });
    await page.goto(BASE + "/?empty&nosource");
    const empty = await page.evaluate(() => window.PropertiesService.getScriptProperties().getProperty("CFG_SOURCE"));
    expect(empty).toBeNull();
    await page.close();
  }, 60_000);
  it("api_reloadData works for the owner and is forbidden for viewer@example.com", async () => {
    const page = await browser.newPage();
    await page.goto(BASE + "/");
    const owner = await page.evaluate(() => window.api_reloadData({}));
    expect(owner.ok).toBe(true);
    expect(owner.data.tabs.map((t: { key: string }) => t.key)).toEqual(["apps", "ciat", "aud", "drp", "plat"]);
    expect(owner.data.dataVersion).toBe(1);
    await page.goto(BASE + "/?as=viewer@example.com");
    const viewer = await page.evaluate(() => window.api_reloadData({}));
    expect(viewer).toMatchObject({ ok: false, errorKind: "forbidden" });
    const viaRun = await page.evaluate(
      () => new Promise((resolve, reject) => window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api_reloadData({})),
    );
    expect(viaRun).toMatchObject({ ok: false, errorKind: "forbidden" });
    await page.close();
  }, 60_000);
});
