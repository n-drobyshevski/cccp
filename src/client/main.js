// Stub bootstrap. The real boot sequence replaces this in the client foundation work package.
import { html } from "./lib/html.js";

function boot() {
  const app = document.getElementById("app");
  if (!app) return;
  app.textContent = String(html`CCCP`);
}

boot();
