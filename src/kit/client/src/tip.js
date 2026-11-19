// Extracted from the author's production Apps Script apps; adapted.
// Tooltips from data-tip. They open on hover AND on keyboard focus, and close on Escape,
// scroll, press or leaving. The tip text must also be in the trigger's aria-label or visible
// text (the caller's job): the card is a courtesy, not the only copy. Placement maths is in
// tipPlace.js. The card text is set with textContent, never as markup.
import { CLOSE_GRACE, tipDelay, tipPlacement } from "./tipPlace.js";

const CARD_ID = "gk-tip";

/** @type {Set<() => void>} */
const activeCloses = new Set();

/** Close the open tip at once (navigation, Escape, a click). */
export function closeTips() {
  for (const c of Array.from(activeCloses)) c();
}

/**
 * Install the tip listeners under `root` (an element or the document). Returns a function
 * that removes them again.
 * @param {Element | Document} root
 * @returns {() => void}
 */
export function installTips(root) {
  const doc = /** @type {Document} */ (/** @type {any} */ (root).ownerDocument || root);
  const win = /** @type {any} */ (doc.defaultView || globalThis);
  /** @type {any} */
  let card = null;
  /** @type {any} */
  let current = null;
  /** @type {any} */
  let openTimer = 0;
  /** @type {any} */
  let closeTimer = 0;
  /** @type {any} */
  let watchTimer = 0;
  let lastClose = -Infinity;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function ensureCard() {
    if (card) return card;
    card = doc.createElement("div");
    card.className = "tip";
    // The first card in a document keeps the plain id; a second install (another root, another
    // bundle) gets a numbered one, so ids stay unique and aria-describedby points at its own card.
    let id = CARD_ID;
    for (let n = 2; doc.getElementById(id); n++) id = CARD_ID + "-" + n;
    card.id = id;
    card.setAttribute("role", "tooltip");
    card.hidden = true;
    card.addEventListener("mouseover", () => onCardOver());
    card.addEventListener("mouseout", () => onCardOut());
    doc.body.appendChild(card);
    return card;
  }

  /** @param {any} target */
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
    const p = tipPlacement(
      { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight },
    );
    el.style.left = Math.round(p.left) + "px";
    el.style.top = Math.round(p.top) + "px";
    el.style.setProperty("--tip-arrow", Math.round(p.arrow) + "px");
    el.setAttribute("data-side", p.side);
    el.style.visibility = "";
    // Append the card to any describedby the app set, and take only it away on close.
    const prev = (target.getAttribute("aria-describedby") || "").split(/\s+/).filter((/** @type {string} */ x) => x && x !== el.id);
    target.setAttribute("aria-describedby", prev.concat(el.id).join(" "));
    watchTimer = setInterval(() => {
      // The trigger was replaced by a redraw: close rather than hang on a detached node.
      if (current && current.isConnected === false) close();
    }, 250);
  }

  function close() {
    clearInterval(watchTimer);
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (current) {
      const id = card ? card.id : "";
      const rest = (current.getAttribute("aria-describedby") || "").split(/\s+/).filter((/** @type {string} */ x) => x && x !== id);
      if (rest.length) current.setAttribute("aria-describedby", rest.join(" "));
      else current.removeAttribute("aria-describedby");
      current = null;
      lastClose = now();
    }
    if (card) card.hidden = true;
  }

  /** @param {any} target @param {boolean} viaFocus */
  function schedule(target, viaFocus) {
    clearTimeout(closeTimer);
    if (current === target) return;
    clearTimeout(openTimer);
    const wait = tipDelay({ viaFocus, sinceLastClose: now() - lastClose });
    if (wait === 0) { close(); show(target); return; }
    openTimer = setTimeout(() => { close(); show(target); }, wait);
  }

  function leave() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, CLOSE_GRACE);
  }

  // The card is outside root: keep it open while the pointer is on it (WCAG 1.4.13, hoverable).
  const onCardOver = () => clearTimeout(closeTimer);
  const onCardOut = () => { leave(); };
  /** @param {any} ev */
  const triggerOf = (ev) => (ev.target && typeof ev.target.closest === "function" ? ev.target.closest("[data-tip]") : null);
  // With nested installs (a root inside another installed root) the innermost one, which hears
  // the bubbling event first, owns the trigger, so one tip opens and not two.
  /** @param {any} ev */
  const claim = (ev) => {
    if (ev.gkTipClaimed) return false;
    try { ev.gkTipClaimed = true; } catch (e) { /* a frozen event: no nesting to resolve */ }
    return true;
  };
  /** @type {Array<[any, string, (ev: any) => void]>} */
  const subs = [
    [root, "mouseover", (ev) => { const t = triggerOf(ev); if (t && claim(ev)) schedule(t, false); }],
    [root, "mouseout", (ev) => { if (triggerOf(ev)) leave(); }],
    [root, "focusin", (ev) => { const t = triggerOf(ev); if (t && claim(ev)) schedule(t, true); }],
    [root, "focusout", (ev) => { if (triggerOf(ev)) close(); }],
    [doc, "keydown", (ev) => { if (ev.key === "Escape") close(); }],
    [doc, "pointerdown", () => close()],
    [win, "scroll", () => close()],
    [win, "resize", () => close()],
  ];
  for (const [t, type, fn] of subs) t.addEventListener(type, fn, type === "scroll");
  activeCloses.add(close);

  return () => {
    for (const [t, type, fn] of subs) t.removeEventListener(type, fn, type === "scroll");
    close();
    if (card && card.parentNode) card.parentNode.removeChild(card);
    card = null;
    activeCloses.delete(close);
  };
}
