// Extracted from the author's production Apps Script apps; adapted.
// The boot splash: a veil the page paints before any script runs, removed once the app has
// drawn. The element is marked data-splash. Reduced motion removes it at once; otherwise it
// fades (class "hiding") and goes on transitionend, with a timer as the fallback for a
// transition that never fires (a backgrounded tab).

/**
 * @param {{ selector?: string, fadeMs?: number }} [opts]
 * @returns {boolean} true when a splash was found
 */
export function hideSplash(opts) {
  const sel = (opts && opts.selector) || "[data-splash]";
  const el = document.querySelector(sel);
  if (!el) return false;
  const mm = typeof window !== "undefined" && window.matchMedia;
  const reduce = !!mm && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { el.remove(); return true; }
  el.classList.add("hiding");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
  };
  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, (opts && opts.fadeMs) || 240);
  return true;
}
