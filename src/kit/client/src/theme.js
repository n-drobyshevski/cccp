// Extracted from the author's production Apps Script apps; adapted.
// Light, dark or auto. The choice lives in localStorage under "<prefix>theme" (JSON) and is
// applied as data-theme on the root element; "auto" removes the attribute so the stylesheet's
// prefers-color-scheme rule decides. themeBootScript() is the pre-paint script for the page
// head, so a dark choice never flashes light.

import { withViewTransition } from "./motion.js";

/** @typedef {"light" | "dark" | "auto"} ThemeMode */

/**
 * The text of a small script that applies the stored theme before first paint. Embed it in a
 * script element in the head of the page.
 * @param {string} [prefix] the same prefix the app passes to createStorage
 * @returns {string}
 */
export function themeBootScript(prefix) {
  const key = JSON.stringify(String(prefix || "") + "theme").replace(/</g, "\\u003c");
  return (
    "try{var v=localStorage.getItem(" + key + ");" +
    "if(v){try{v=JSON.parse(v)}catch(e){}" +
    "if(v==='light'||v==='dark')document.documentElement.setAttribute('data-theme',v)}}catch(e){}"
  );
}

/**
 * Apply and remember a theme. `storage` is a createStorage object (omit it to only apply).
 * @param {ThemeMode} mode
 * With `transition: true` the change runs inside a view transition (a crossfade) when the
 * browser supports it and motion is not reduced.
 * @param {{ storage?: { set: (k: string, v: unknown) => boolean, remove: (k: string) => boolean } | null, root?: Element, transition?: boolean }} [opts]
 * @returns {ThemeMode} the mode that was applied
 */
export function setTheme(mode, opts) {
  const m = mode === "light" || mode === "dark" ? mode : "auto";
  const root = (opts && opts.root) || document.documentElement;
  const apply = () => {
    if (m === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", m);
  };
  if (opts && opts.transition) withViewTransition(apply); else apply();
  const st = opts && opts.storage;
  if (st) { if (m === "auto") st.remove("theme"); else st.set("theme", m); }
  return m;
}

/**
 * The stored theme, or "auto".
 * @param {{ get: (k: string) => any } | null | undefined} storage
 * @returns {ThemeMode}
 */
export function getTheme(storage) {
  const v = storage ? storage.get("theme") : null;
  return v === "light" || v === "dark" ? v : "auto";
}
