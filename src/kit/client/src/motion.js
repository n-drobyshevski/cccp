// Motion helpers: a reduced-motion preference, exits, keyed swaps with FLIP, view transitions
// and a count-up. Every helper degrades to "just do it" when motion is reduced or the browser
// lacks the API. Durations come from the --dur-N tokens (see packages/ui tokens.base.css).
import { renderRegion } from "./dom.js";
import { createStorage } from "./storage.js";

/** @typedef {"system" | "reduce" | "full"} MotionPref */

const EASE_EXIT = "cubic-bezier(0.2, 0, 1, 0.9)";
const EASE_STANDARD = "cubic-bezier(0.2, 0, 0.38, 0.9)";
const FALLBACK_MS = /** @type {Record<string, number>} */ ({
  "--dur-1": 70, "--dur-2": 120, "--dur-3": 180, "--dur-4": 240, "--dur-5": 400,
});

/**
 * A duration token in milliseconds, or the fallback when the DOM has none.
 * @param {string} name for example "--dur-3"
 * @param {number} [fallback] defaults to the documented value of the token
 * @returns {number}
 */
export function tokenMs(name, fallback) {
  const fb = typeof fallback === "number" ? fallback : (FALLBACK_MS[name] ?? 0);
  try {
    const g = /** @type {any} */ (globalThis);
    if (typeof g.getComputedStyle !== "function" || typeof document === "undefined") return fb;
    const raw = String(g.getComputedStyle(document.documentElement).getPropertyValue(name) || "").trim();
    const m = /^(-?\d*\.?\d+)(ms|s)?$/.exec(raw);
    if (!m) return fb;
    const n = parseFloat(m[1]);
    return m[2] === "s" ? n * 1000 : n;
  } catch (e) { return fb; }
}

/**
 * True when motion should be reduced: data-motion on the root element wins ("reduce" is true,
 * "full" is false), then the prefers-reduced-motion media query.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  try {
    const attr = typeof document !== "undefined" && document.documentElement
      ? document.documentElement.getAttribute("data-motion") : null;
    if (attr === "reduce") return true;
    if (attr === "full") return false;
    const w = /** @type {any} */ (globalThis).window;
    if (w && typeof w.matchMedia === "function") return !!w.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { /* fall through */ }
  return false;
}

/**
 * The pre-paint script that applies a stored motion choice as data-motion. Embed it in a script
 * element in the head of the page, next to themeBootScript.
 * @param {string} [prefix] the same prefix the app passes to createStorage
 * @returns {string}
 */
export function motionBootScript(prefix) {
  const key = JSON.stringify(String(prefix || "") + "motion").replace(/</g, "\\u003c");
  return (
    "try{var v=localStorage.getItem(" + key + ");" +
    "if(v){try{v=JSON.parse(v)}catch(e){}" +
    "if(v==='reduce'||v==='full')document.documentElement.setAttribute('data-motion',v)}}catch(e){}"
  );
}

/**
 * Apply and remember a motion preference. "system" removes the attribute and the stored value.
 * @param {MotionPref} pref
 * @param {{ prefix?: string, root?: Element }} [opts]
 * @returns {MotionPref} the preference that was applied
 */
export function setMotion(pref, opts) {
  const p = pref === "reduce" || pref === "full" ? pref : "system";
  const root = (opts && opts.root) || document.documentElement;
  if (p === "system") root.removeAttribute("data-motion");
  else root.setAttribute("data-motion", p);
  const st = createStorage((opts && opts.prefix) || "");
  if (p === "system") st.remove("motion"); else st.set("motion", p);
  return p;
}

/**
 * The stored motion preference, or "system".
 * @param {string} [prefix]
 * @returns {MotionPref}
 */
export function getMotion(prefix) {
  const v = createStorage(prefix || "").get("motion");
  return v === "reduce" || v === "full" ? v : "system";
}

/**
 * Play an exit animation and resolve when it ends. Resolves at once when motion is reduced or
 * the element cannot animate, and after a timeout if the animation never reports back.
 * @param {Element} el
 * @param {Keyframe[]} [frames] default: fade out and move down a little
 * @param {KeyframeAnimationOptions} [opts] default: --dur-3 with the exit easing
 * @returns {Promise<void>}
 */
export function animateOut(el, frames, opts) {
  const anyEl = /** @type {any} */ (el);
  if (prefersReducedMotion() || !el || typeof anyEl.animate !== "function") return Promise.resolve();
  const dur = tokenMs("--dur-3", 180);
  const f = frames || [
    { opacity: 1, transform: "translateY(0)" },
    { opacity: 0, transform: "translateY(4px)" },
  ];
  const o = Object.assign({ duration: dur, easing: EASE_EXIT, fill: "forwards" }, opts || {});
  return new Promise((resolve) => {
    let done = false;
    /** @type {any} */
    let timer = null;
    const finish = () => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(); };
    timer = setTimeout(finish, (Number(o.duration) || dur) + 100);
    try {
      const a = anyEl.animate(f, o);
      if (a && a.finished && typeof a.finished.then === "function") a.finished.then(finish, finish);
      else finish();
    } catch (e) { finish(); }
  });
}

/**
 * Render SafeHtml into a region like renderRegion, plus motion: nodes with a new key get
 * data-enter (removed after the entrance), and keyed nodes that moved play a FLIP translate.
 * @param {Element} region
 * @param {unknown} safe SafeHtml from the html template
 * @param {{ key?: string, flip?: boolean, keepFocus?: boolean, keepScroll?: boolean }} [opts]
 * @returns {void}
 */
export function swap(region, safe, opts) {
  const o = opts || {};
  const key = o.key || "data-key";
  const sel = "[" + key + "]";
  /** @param {Element} root */
  const measure = (root) => {
    /** @type {Map<string, { el: Element, x: number, y: number }>} */
    const m = new Map();
    for (const el of Array.prototype.slice.call(root.querySelectorAll(sel))) {
      const k = el.getAttribute(key);
      if (k == null || m.has(k)) continue;
      const r = el.getBoundingClientRect();
      m.set(k, { el, x: r.left, y: r.top });
    }
    return m;
  };
  const reduce = prefersReducedMotion();
  const before = measure(region);
  renderRegion(region, safe, { keepFocus: o.keepFocus, keepScroll: o.keepScroll });
  const after = measure(region);

  /** @type {Element[]} */
  const entering = [];
  /** @type {Array<{ el: any, dx: number, dy: number }>} */
  const moved = [];
  for (const [k, n] of after) {
    const b = before.get(k);
    if (!b) { entering.push(n.el); continue; }
    const dx = b.x - n.x;
    const dy = b.y - n.y;
    if (dx || dy) moved.push({ el: n.el, dx, dy });
  }

  if (entering.length) {
    const ms = tokenMs("--dur-4", 240);
    for (const el of entering) {
      el.setAttribute("data-enter", "");
      /** @type {any} */
      let timer = null;
      const clear = () => {
        if (timer) clearTimeout(timer);
        el.removeEventListener("animationend", onEnd);
        el.removeEventListener("transitionend", onEnd);
        el.removeAttribute("data-enter");
      };
      /** @param {any} ev */
      const onEnd = (ev) => { if (!ev || ev.target === el) clear(); };
      el.addEventListener("animationend", onEnd);
      el.addEventListener("transitionend", onEnd);
      timer = setTimeout(clear, ms + 50);
    }
  }

  if (o.flip !== false && !reduce) {
    const dur = tokenMs("--dur-3", 180);
    for (const m of moved) {
      if (typeof m.el.animate !== "function") continue;
      try {
        m.el.animate(
          [{ transform: "translate(" + m.dx + "px, " + m.dy + "px)" }, { transform: "none" }],
          { duration: dur, easing: EASE_STANDARD },
        );
      } catch (e) { /* a failed FLIP is only a missing flourish */ }
    }
  }
}

/**
 * Run a DOM update inside a view transition when the browser has one and motion is allowed.
 * Otherwise call update() at once. Resolves when the transition ends or the update is done.
 * @param {() => unknown} update
 * @returns {Promise<void>}
 */
export function withViewTransition(update) {
  const d = /** @type {any} */ (typeof document !== "undefined" ? document : null);
  if (d && typeof d.startViewTransition === "function" && !prefersReducedMotion()) {
    try {
      const vt = d.startViewTransition(update);
      return Promise.resolve(vt && vt.finished).then(() => undefined, () => undefined);
    } catch (e) { /* fall through to the plain update */ }
  }
  try {
    return Promise.resolve(update()).then(() => undefined);
  } catch (e) { return Promise.reject(e); }
}

/** @type {WeakMap<object, number>} */
const counts = new WeakMap();

/**
 * Count a number up (or down) in an element's text, easing out. Writes text only. Under reduced
 * motion, or with no requestAnimationFrame, the final text is set at once. A newer countUp on
 * the same element cancels the older one. The last frame is always exactly format(to).
 * @param {Element} el
 * @param {number} to
 * @param {{ from?: number, duration?: number, format?: (n: number) => string }} [opts]
 * @returns {Promise<void>} resolves when the final text is set
 */
export function countUp(el, to, opts) {
  const o = opts || {};
  const from = typeof o.from === "number" ? o.from : 0;
  const format = o.format || ((n) => String(Math.round(n)));
  const duration = typeof o.duration === "number" ? o.duration : tokenMs("--dur-5", 400);
  const g = /** @type {any} */ (globalThis);
  const raf = typeof g.requestAnimationFrame === "function" ? g.requestAnimationFrame.bind(g) : null;
  const id = (counts.get(el) || 0) + 1;
  counts.set(el, id);
  const setFinal = () => { el.textContent = format(to); };
  if (!raf || prefersReducedMotion() || !(duration > 0) || !isFinite(to) || !isFinite(from) || from === to) {
    setFinal();
    return Promise.resolve();
  }
  el.textContent = format(from);
  return new Promise((resolve) => {
    /** @type {number | null} */
    let t0 = null;
    /** @param {number} ts */
    const step = (ts) => {
      if (counts.get(el) !== id) { resolve(); return; }
      if (t0 === null) t0 = ts;
      const p = Math.min(1, Math.max(0, (ts - t0) / duration));
      if (p >= 1) { setFinal(); resolve(); return; }
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(from + (to - from) * eased);
      raf(step);
    };
    raf(step);
  });
}
