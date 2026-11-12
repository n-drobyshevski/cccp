// The branded splash shown while the app opens for the first time: the four CCCP dots pulsing in
// turn, the name, one line of what is happening and a row of three steps driven by the real
// boot events. The same markup is baked into index.html so it paints before any script runs;
// the router keeps that copy and only updates the line and the steps in place.
import { renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";

/** The boot steps in order: the bootstrap call, the register fetch, deriving the status. */
export const BOOT_STEPS = [
  { key: "access", label: "Checking access", line: "Checking who you are…" },
  { key: "apps", label: "Loading applications", line: "Reading the register…" },
  { key: "status", label: "Working out status", line: "Working out status…" },
];

const indexOf = (step) => Math.max(0, BOOT_STEPS.findIndex((s) => s.key === step));

/** The status line under the name. */
export function lineView(step) {
  return html`<p class="boot-line">${BOOT_STEPS[indexOf(step)].line}</p>`;
}

/** The step row: steps before the current one are done, the current one is active. */
export function stepsView(step) {
  const at = indexOf(step);
  return html`<ol class="boot-steps" aria-label="Progress">${BOOT_STEPS.map((s, i) => {
    const state = i < at ? "done" : i === at ? "active" : "todo";
    return html`<li data-step="${s.key}" data-state="${state}"${i === at ? html` aria-current="step"` : ""}>${s.label}${state === "done" ? html`<span class="sr-only"> (done)</span>` : ""}</li>`;
  })}</ol>`;
}

/** The whole splash for a step. */
export function splashView(step) {
  return html`<section class="boot" data-splash role="status" aria-busy="true"><div class="boot-in"><span class="boot-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b class="boot-name">CCCP</b><span class="sr-only">Opening the CCCP register</span><div data-slot="line">${lineView(step)}</div><div data-slot="steps">${stepsView(step)}</div><div data-slot="slow"></div></div></section>`;
}

/** Move a drawn splash to a step without redrawing it, so the dots keep pulsing. */
export function updateSplash(el, step) {
  const line = el.querySelector('[data-slot="line"]');
  const steps = el.querySelector('[data-slot="steps"]');
  if (line) renderRegion(line, lineView(step), { keepFocus: false, keepScroll: false });
  if (steps) renderRegion(steps, stepsView(step), { keepFocus: false, keepScroll: false });
}

/** True when `el` already holds a splash (the copy index.html shipped). */
export const hasSplash = (el) => !!el.querySelector("[data-splash]");
