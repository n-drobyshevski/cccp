// A short message at the bottom of the window, on the kit toaster: a visible stack plus polite
// and assertive announcers, a kind word (Info, Done, Warning, Error), a dismiss button, and the
// timer paused while the pointer or focus is on the stack.
// opts: kind ('ok'|'err'|'warn'), ms, link {href, label} (href from the server; the kit shows
// only https and mailto links). Returns {close}.
import { delegate } from "@gas-kit/client/dom.js";
import { createToaster } from "@gas-kit/ui/components/toast.js";

/** @type {ReturnType<typeof createToaster> | null} */
let toaster = null;
/** @type {HTMLElement | null} */
let region = null;

const KINDS = { ok: "ok", err: "bad", warn: "warn" };

function ensure() {
  if (toaster && region && region.isConnected) return toaster;
  region = document.createElement("div");
  region.className = "toasts";
  document.body.appendChild(region);
  // Keep the toasts a stack of any length the app raises (a run of Sheet exports shows each link).
  toaster = createToaster(region, { max: 8, focusFallback: () => document.querySelector("main, body") });
  const t = toaster;
  delegate(region, "click", '[data-act="toast:dismiss"]', (ev, el) => t.dismiss(el.getAttribute("data-id") || ""));
  return t;
}

export function toast(message, opts) {
  const o = opts || {};
  const t = ensure();
  const id = t.show(String(message), { kind: KINDS[o.kind] || "info", ms: o.ms, link: o.link || null });
  return { close: () => t.dismiss(id) };
}
