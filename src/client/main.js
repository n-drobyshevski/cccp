// Boot. 1) read the bootstrap the page carried, else ask for it; 2) theme; 3) the register:
// inline, else fetched behind the splash; 4) the address. Then the router draws the page.
import { isNoSource } from "./state/noSource.js";
import { installTips } from "@gas-kit/client/tip.js";
import { boot as bootPayload } from "@gas-kit/client/rpc.js";
import { errorText } from "./lib/errorText.js";
import { homeRoute, mountAppbar } from "./shell/appbar.js";
import { startRouter } from "./shell/router.js";
import "./pages/overview.js";
import "./pages/list.js";
import "./pages/heatmap.js";
import "./pages/landscape.js";
import "./pages/factsheet/page.js";
import "./pages/settings/page.js";
import * as theme from "./shell/theme.js";
import * as register from "./state/register.js";
import { store } from "./state/store.js";
import * as url from "./state/url.js";

function failure(e) {
  if (e && e.kind === "forbidden") {
    return { status: "denied", message: e.message, contact: e.contact || "", contactUrl: e.contactUrl || "" };
  }
  return { status: "error", message: errorText(e, "The register could not be loaded.") };
}

let ran = 0;

// A timer, not a frame callback: a hidden tab never runs those, and the boot must not wait on one.
const paint = () => new Promise((resolve) => setTimeout(resolve, 40));

export async function boot() {
  const mine = ++ran;
  store.set({ boot: { status: "loading", message: "", step: "access" } });
  try {
    // The kit reads the inline payload once (and removes it), so a Retry asks the server.
    const data = await bootPayload({ id: "boot-data", endpoint: "bootstrap" });
    if (mine !== ran) return;
    const { core, live } = data;
    theme.init(core.publicSettings.display.theme);
    store.set({ core, live, boot: { status: "loading", message: "", step: "apps" } });
    const noSource = isNoSource(core);
    const context = { rules: core.publicSettings.rules, display: core.publicSettings.display, today: live.today };
    const located = url.init({ fallbackRoute: homeRoute(store.get()) });
    const onPayload = () => {
      if (mine !== ran) return undefined;
      store.set({ boot: { status: "loading", message: "", step: "status" } });
      return paint();
    };
    if (!noSource) await Promise.all([register.ready(context, data.register, onPayload), located]);
    else await located;
    if (mine !== ran) return;
    store.set({ booted: true, boot: { status: noSource ? "nosource" : "ready", message: "" } });
  } catch (e) {
    if (mine !== ran) return;
    store.set({ booted: true, boot: failure(e) });
  }
}

function start() {
  const bar = document.getElementById("appbar");
  const main = document.getElementById("main");
  if (!bar || !main) return;
  installTips(document);
  theme.init("light");
  mountAppbar(bar);
  startRouter(main, { retry: () => boot() });
  boot();
}

start();
