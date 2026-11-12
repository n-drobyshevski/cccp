import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// The Export menu on the list against the dev server: CSV and Excel downloads fire with the
// right names and content, the Sheet export raises a toast with a real link, and a failure
// says so.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).replace(/,/g, ""));

async function ready(page: Page, query = "") {
  await page.goto("/?r=list" + query);
  await expect(page.locator("table[data-table=list]")).toBeVisible();
}

const openMenu = async (page: Page) => {
  await page.locator(".rtools").getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
};

test.describe("export", () => {
  test("the menu names the filtered count and offers three exports", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await openMenu(page);
    const n = await visible(page);
    await expect(page.locator(".pop .mlbl")).toHaveText("Export " + n.toLocaleString("en-US") + " applications");
    await expect(page.getByRole("button", { name: /CSV file/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Excel workbook/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /New Google Sheet/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Export" })).toHaveCount(0);
    expect(bad).toEqual([]);
  });

  test("CSV downloads every filtered row, not the drawn page, with BOM and CRLF", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page, "&tier=T1,T2,T3");
    await expect(page.locator("[data-count=visible]")).not.toHaveText("");
    const n = await visible(page);
    expect(n).toBeGreaterThan(50);
    await openMenu(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /CSV file/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^cccp-list-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync((await dl.path())!, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[lines.length - 1]).toBe("");
    expect(lines.length - 2).toBeGreaterThanOrEqual(n);
    expect(lines[0].startsWith("Application,")).toBe(true);
    await expect(page.locator(".toast")).toContainText("Downloaded " + dl.suggestedFilename());
    expect(bad).toEqual([]);
  });

  test("CSV columns follow the visible columns", async ({ page }) => {
    await ready(page, "&cols=-d,%2Bsd");
    await openMenu(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /CSV file/ }).click()]);
    const head = readFileSync((await dl.path())!, "utf8").slice(1).split("\r\n")[0];
    expect(head).toContain("Subdomain");
    expect(head).not.toContain("Domain,");
  });

  test("Excel downloads a zip named for the route and date", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await openMenu(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel workbook/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^cccp-list-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const bytes = readFileSync((await dl.path())!);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]));
    expect(bytes.includes(Buffer.from("xl/worksheets/sheet1.xml"))).toBe(true);
    expect(bad).toEqual([]);
  });

  test("Excel: the browser itself parses every XML part", async ({ page }) => {
    await ready(page);
    await openMenu(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel workbook/ }).click()]);
    const b64 = readFileSync((await dl.path())!).toString("base64");
    const bad = await page.evaluate((data) => {
      const bin = atob(data);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const dv = new DataView(bytes.buffer);
      const errors: string[] = [];
      let p = 0;
      while (dv.getUint32(p, true) === 0x04034b50) {
        const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
        const body = new TextDecoder().decode(bytes.subarray(p + 30 + nl + el, p + 30 + nl + el + size));
        const doc = new DOMParser().parseFromString(body, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) errors.push(name);
        p += 30 + nl + el + size;
      }
      return errors;
    }, b64);
    expect(bad).toEqual([]);
  });

  test("New Google Sheet toasts a link to the created file", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await openMenu(page);
    await page.getByRole("button", { name: /New Google Sheet/ }).click();
    const link = page.locator(".toast a");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Open Sheet");
    expect(await link.getAttribute("href")).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/export-\d+\/edit$/);
    await expect(link).toHaveAttribute("target", "_blank");
    expect(await page.evaluate(() => (window as any).__rpcLog.filter((n: string) => n === "exportToSheet").length)).toBe(1);
    expect(bad).toEqual([]);
  });

  test("the sixth Sheet in ten minutes says so", async ({ page }) => {
    await ready(page);
    for (let i = 0; i < 5; i++) {
      await openMenu(page);
      await page.getByRole("button", { name: /New Google Sheet/ }).click();
      await expect(page.locator(".toast a")).toHaveCount(i + 1);
    }
    await openMenu(page);
    await page.getByRole("button", { name: /New Google Sheet/ }).click();
    await expect(page.locator(".toast.err")).toContainText("5 Google Sheets");
  });

  test("an empty result disables the exports", async ({ page }) => {
    await page.goto("/?r=list&q=zzzzzzzznomatch");
    await expect(page.locator(".empty")).toBeVisible();
    await expect(page.locator("[data-count=visible]")).toHaveText("0");
    await openMenu(page);
    await expect(page.getByRole("button", { name: /CSV file/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /New Google Sheet/ })).toBeDisabled();
  });
});
