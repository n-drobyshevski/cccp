// Tooltips from data-tip. They open on hover AND on keyboard focus, and close on Escape,
// scroll, press or leaving. The tip text must also be in the trigger's aria-label or visible
// text (the caller's job): the card is a courtesy, not the only copy. Placement maths is the
// vendored tipPlace.js.
import { CLOSE_GRACE, tipDelay, tipPlacement } from "../../vendor/gas_shared/ui/tipPlace.js";

let card = null;
let current = null;
let openTimer = 0;
let closeTimer = 0;
let lastClose = -Infinity;
let ready = false;

function ensureCard() {
  if (card) return card;
  card = document.createElement("div");
  card.className = "tip";
  card.id = "cccp-tip";
  card.setAttribute("role", "tooltip");
  card.hidden = true;
  document.body.appendChild(card);
  return card;
}

function show(target) {
  const text = target.getAttribute("data-tip");
  if (!text) return;
  const el = ensureCard();
  current = target;
  el.textContent = text;
  el.hidden = false;
  el.style.visibility = "hidden";
  el.style.left = "0px";
  el.style.top = "0px";
  const r = target.getBoundingClientRect();
  const size = { width: el.offsetWidth, height: el.offsetHeight };
  const p = tipPlacement(
    { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width },
    size,
    { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
  );
  el.style.left = Math.round(p.left) + "px";
  el.style.top = Math.round(p.top) + "px";
  el.style.setProperty("--tip-arrow", Math.round(p.arrow) + "px");
  el.setAttribute("data-side", p.side);
  el.style.visibility = "";
  target.setAttribute("aria-describedby", el.id);
}

/** Close the tip at once (navigation, Escape, a click). */
export function closeTips() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (current) {
    current.removeAttribute("aria-describedby");
    current = null;
    lastClose = performance.now();
  }
  if (card) card.hidden = true;
}

function schedule(target, viaFocus) {
  clearTimeout(closeTimer);
  if (current === target) return;
  clearTimeout(openTimer);
  const wait = tipDelay({ viaFocus, sinceLastClose: performance.now() - lastClose });
  if (wait === 0) { closeTips(); show(target); return; }
  openTimer = setTimeout(() => { closeTips(); show(target); }, wait);
}

function leave() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closeTips, CLOSE_GRACE);
}

const triggerOf = (ev) => (ev.target && typeof ev.target.closest === "function" ? ev.target.closest("[data-tip]") : null);

/** Install the document listeners once. */
export function initTip() {
  if (ready) return;
  ready = true;
  document.addEventListener("mouseover", (ev) => { const t = triggerOf(ev); if (t) schedule(t, false); });
  document.addEventListener("mouseout", (ev) => { if (triggerOf(ev)) leave(); });
  document.addEventListener("focusin", (ev) => { const t = triggerOf(ev); if (t) schedule(t, true); });
  document.addEventListener("focusout", (ev) => { if (triggerOf(ev)) closeTips(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeTips(); });
  document.addEventListener("pointerdown", closeTips);
  window.addEventListener("scroll", closeTips, true);
  window.addEventListener("resize", closeTips);
}
