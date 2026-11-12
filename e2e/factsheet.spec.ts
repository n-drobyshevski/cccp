import { expect, test, type Page } from "@playwright/test";

// The application fact sheet against the dev server: header and status jumps, jump select and find,
// persistence of sections and sidebar, people, recently viewed, copy link, open row in sheet and the
// not-found state.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

async function ids(page: Page): Promise<string[]> {
  await page.goto("/?r=list");
  await expect(page.locator("tr[data-id]").first()).toBeVisible();
  return page.locator("tr[data-id]").evaluateAll((els) => els.slice(0, 12).map((e) => e.getAttribute("data-id")!));
}

async function open(page: Page, id: string) {
  await page.goto("/?app=" + id);
  await expect(page.locator(".hx h1")).toBeVisible();
}

test("header, tabs, sections and sidebar are drawn", async ({ page }) => {
  const bad = watchConsole(page);
  const [id] = await ids(page);
  await open(page, id!);
  await expect(page.locator(".crumbs")).toContainText("Inventory");
  await expect(page.locator(".hx .meta")).toContainText("owned by");
  await expect(page.locator("[data-fs=pct]")).toContainText("%");
  await expect(page.locator(".seal").first()).toBeVisible();
  await expect(page.locator(".score .sc")).toHaveCount(4);
  await expect(page.locator(".score .sc .gl")).toHaveCount(4);
  await expect(page.locator("details.fsx")).toHaveCount(5);
  await expect(page.locator(".ftabs [role=tab]")).toHaveText([/Fact sheet/, /People/]);
  await expect(page.locator("aside.dq")).toContainText("mandatory fields");
  expect(await page.locator("[title]").count()).toBe(0);
  expect(bad).toEqual([]);
});

test("status buttons and the jump select go to their section, find narrows", async ({ page }) => {
  const [id] = await ids(page);
  await open(page, id!);
  await page.locator(".score .sc", { hasText: "Platform" }).click();
  await expect(page.locator("#sx-platform")).toBeInViewport();
  await page.locator("select.jump").selectOption("continuity");
  await expect(page.locator("#sx-continuity")).toBeInViewport();
  await page.locator("input.fsearch").fill("pentest");
  await expect(page.locator("details.fsx")).toHaveCount(1);
  await expect(page.locator("#sx-cyber")).toContainText("Last pentest");
  await page.locator("input.fsearch").fill("zzzz-nothing");
  await expect(page.locator("details.fsx")).toHaveCount(0);
  await expect(page.locator(".nomatch")).toBeVisible();
  await page.locator("input.fsearch").fill("");
  await expect(page.locator("details.fsx")).toHaveCount(5);
});

test("closed sections and the collapsed sidebar persist across a reload", async ({ page }) => {
  const [id] = await ids(page);
  await open(page, id!);
  await page.locator("#sx-cyber > summary").click();
  await expect(page.locator("#sx-cyber")).not.toHaveAttribute("open", "");
  await page.locator("[data-act=side]").click();
  await expect(page.locator(".dqmini")).toBeVisible();
  await page.reload();
  await expect(page.locator(".hx h1")).toBeVisible();
  await expect(page.locator("#sx-cyber")).not.toHaveAttribute("open", "");
  await expect(page.locator("#sx-compliance")).toHaveAttribute("open", "");
  await expect(page.locator(".dqmini")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("cccp.fs.closed"))).toBe('["cyber"]');
  await page.evaluate(() => window.scrollTo(0, 1200));
  const mini = await page.locator(".dqmini").evaluate((e) => e.getBoundingClientRect().top);
  expect(mini).toBeGreaterThanOrEqual(0);
  expect(mini).toBeLessThanOrEqual(20);
  await page.locator("[data-act=side]").click();
  await page.locator("#sx-cyber > summary").click();
  await expect(page.locator("aside.dq")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1200));
  const dqTop = await page.locator("aside.dq").evaluate((e) => e.getBoundingClientRect().top);
  expect(dqTop).toBeGreaterThanOrEqual(0);
  expect(dqTop).toBeLessThanOrEqual(20);
  await expect(page.locator("#sx-cyber")).toHaveAttribute("open", "");
});

test("people tab lists the three roles and flags a missing person", async ({ page }) => {
  const [id] = await ids(page);
  await open(page, id!);
  await page.getByRole("tab", { name: /People/ }).click();
  await expect(page.locator(".subs .r")).toHaveCount(3);
  const none = await page.locator(".subs .r .res.bad").count();
  const contacts = await page.locator(".subs .r [data-act=contact]").count();
  expect(none + contacts).toBe(3);
  await expect(page.locator(".subs .hd")).toContainText(String(contacts));
});

test("recently viewed keeps 8 and leaves out the current application", async ({ page }) => {
  const list = await ids(page);
  expect(list.length).toBeGreaterThanOrEqual(11);
  for (const id of list.slice(0, 11)) await open(page, id);
  const last = list[10]!;
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.recent") || "[]") as string[]);
  expect(stored[0]).toBe(last);
  await expect(page.locator("[data-dq=recent] button")).toHaveCount(8);
  expect(await page.locator("[data-dq=recent] button").evaluateAll((b) => b.map((x) => x.getAttribute("data-id")))).not.toContain(last);
  // Clicking one opens it.
  await page.locator("[data-dq=recent] button").first().click();
  await expect(page.locator(".lxwrap")).toHaveAttribute("data-app-id", list[9]!);
});

test("copy link gives ?app= and open row in sheet uses the Sheet url", async ({ page }) => {
  // Capture what is copied instead of depending on clipboard permissions.
  await page.addInitScript(() => {
    (window as unknown as { __copied: string }).__copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => { (window as unknown as { __copied: string }).__copied = t; return Promise.resolve(); } } });
  });
  const [id] = await ids(page);
  await open(page, id!);
  await page.locator("[data-act=copy]").click();
  await expect(page.locator(".toast")).toContainText("Link copied");
  const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(new URL(copied).search).toBe("?app=" + id);
  const href = await page.locator("a[data-act=sheet]").getAttribute("href");
  expect(href).toMatch(/^https:/);
  expect(href).toMatch(/#gid=\d+&range=A\d+$/);
});

test("back returns to where the viewer came from, the domain crumb filters the list", async ({ page }) => {
  await page.goto("/?r=heatmap");
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  await page.locator("button.nm").first().click();
  await expect(page.locator(".hx h1")).toBeVisible();
  await expect(page.locator("[data-k=fs-crumb-back]")).toHaveAttribute("aria-label", "Back to heatmap");
  await page.locator("[data-k=fs-crumb-back]").click();
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  await page.locator("button.nm").first().click();
  const dom = (await page.locator(".crumbs [data-act=crumb-domain]").innerText()).trim();
  await page.locator(".crumbs [data-act=crumb-domain]").click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(dom.length).toBeGreaterThan(0);
  const shown = Number((await page.locator("[data-count=visible]").innerText()).replace(/,/g, ""));
  const rows = await page.locator("tr[data-id]").count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(1125);
  expect(rows).toBeGreaterThan(0);
});

test("an unknown id shows the empty state", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?app=does-not-exist");
  await expect(page.locator(".state.empty")).toContainText("Application not found");
  await page.locator(".state [data-act=back]").click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(bad).toEqual([]);
});
