// A short message at the bottom of the window. It lives in a polite live region, so a screen
// reader announces it. opts: kind ('ok'|'err'), ms, link {href, label} (href from the server).
import { renderRegion } from "./dom.js";
import { html } from "./html.js";

let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.className = "toasts";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

const SAFE_LINK = /^(https|mailto):/i;

export function toast(message, opts) {
  const o = opts || {};
  const item = document.createElement("div");
  item.className = "toast" + (o.kind === "err" ? " err" : "");
  const link = o.link && SAFE_LINK.test(o.link.href || "") ? o.link : null;
  renderRegion(item, html`<span>${message}</span>${link ? html` <a href="${link.href}" target="_blank" rel="noopener noreferrer">${link.label || "Open"}</a>` : ""}`, { keepFocus: false, keepScroll: false });
  ensureHost().appendChild(item);
  const ms = o.ms == null ? (link ? 9000 : 4500) : o.ms;
  const timer = setTimeout(() => item.remove(), ms);
  return { close: () => { clearTimeout(timer); item.remove(); } };
}
