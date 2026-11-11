// Boot. 1) read the bootstrap the page carried, else ask for it; 2) theme; 3) the register:
// inline, else fetched behind a skeleton; 4) the address. Then the router draws the page.
import { initTip } from "./lib/tip.js";
import * as rpc from "./lib/rpc.js";
import { homeRoute, mountAppbar } from "./shell/appbar.js";
import { startRouter } from "./shell/router.js";
import * as theme from "./shell/theme.js";
import * as register from "./state/register.js";
import { store } from "./state/store.js";
import * as url from "./state/url.js";

/** The bootstrap envelope doGet rendered into the page, or null (empty, unreadable, not ok). */
export function inlineBootstrap() {
  const el = document.getElementById("boot-data");
  const text = el ? String(el.textContent || "").trim() : "";
  if (!text) return null;
  try {
    const env = JSON.parse(text);
    return env && env.ok === true && env.data && env.data.core && env.data.live ? env.data : null;
  } catch (e) { return null; }
}

/** The source has never been connected: the server answers with an empty, titleless meta. */
export function isNoSource(core) {
  const m = core.sourceMeta;
  return m.title === "" && m.url === "" && m.loadedAt !== "";
}

function failure(e) {
  if (e && e.kind === "forbidden") {
    return { status: "denied", message: e.message, contact: e.contact || "", contactUrl: e.contactUrl || "" };
  }
  return { status: "error", message: (e && e.message) || "The register could not be loaded." };
}

let ran = 0;

export async function boot() {
  const mine = ++ran;
  store.set({ boot: { status: "loading", message: "" } });
  try {
    const data = inlineBootstrap() || (await rpc.call("bootstrap"));
    if (mine !== ran) return;
    const { core, live } = data;
    theme.init(core.publicSettings.display.theme);
    store.set({ core, live });
    const noSource = isNoSource(core);
    const context = { rules: core.publicSettings.rules, display: core.publicSettings.display, today: live.today };
    const located = url.init({ fallbackRoute: homeRoute(store.get()) });
    if (!noSource) await Promise.all([register.ready(context, data.register), located]);
    else await located;
    if (mine !== ran) return;
    store.set({ boot: { status: noSource ? "nosource" : "ready", message: "" } });
  } catch (e) {
    if (mine !== ran) return;
    store.set({ boot: failure(e) });
  }
}

function start() {
  const bar = document.getElementById("appbar");
  const main = document.getElementById("main");
  if (!bar || !main) return;
  initTip();
  theme.init("system");
  mountAppbar(bar);
  startRouter(main, { retry: () => boot() });
  boot();
}

start();
