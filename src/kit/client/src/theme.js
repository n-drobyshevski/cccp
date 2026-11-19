// Extracted from the author's production Apps Script apps; adapted.
// Light, dark or auto. The choice lives in localStorage under "<prefix>theme" (JSON) and is
// applied as data-theme on the root element; "auto" removes the attribute so the stylesheet's
// prefers-color-scheme rule decides. themeBootScript() is the pre-paint script for the page
// head, so a dark choice never flashes light.

import { withViewTransition } from "./motion.js";

/** @typedef {"light" | "dark" | "auto"} ThemeMode */

/**
 * The text of a small script that applies the stored theme before first paint. Embed it in a
 * script element in the head of the page. A stored value is read as JSON ("dark" in quotes, what
 * createStorage writes) or as a bare string (dark); anything but light or dark is ignored.
 *
 * With no usable stored choice data-theme stays unset, unless `default` is "light" or "dark": an
 * app whose CSS keys light on data-theme="light" passes themeBootScript({ default: "light" }).
 * Any other `default` is ignored (the unset behaviour). The first argument may be the options
 * object itself, for an app with no storage prefix.
 * @param {string | { prefix?: string, default?: "light" | "dark" }} [prefix] the same prefix the app passes to createStorage
 * @param {{ prefix?: string, default?: "light" | "dark" }} [opts]
 * @returns {string}
 */
export function themeBootScript(prefix, opts) {
  const o = prefix && typeof prefix === "object" ? prefix : opts && typeof opts === "object" ? opts : {};
  const p = typeof prefix === "string" ? prefix : o.prefix == null ? "" : String(o.prefix);
  const key = JSON.stringify(p + "theme").replace(/</g, "\\u003c");
  const d = o.default === "light" || o.default === "dark" ? o.default : "";
  // Without a default the script is the original text, so a page that embeds it is unchanged.
  if (!d) {
    return (
      "try{var v=localStorage.getItem(" + key + ");" +
      "if(v){try{v=JSON.parse(v)}catch(e){}" +
      "if(v==='light'||v==='dark')document.documentElement.setAttribute('data-theme',v)}}catch(e){}"
    );
  }
  return (
    "var t='" + d + "';try{var v=localStorage.getItem(" + key + ");" +
    "if(v){try{v=JSON.parse(v)}catch(e){}" +
    "if(v==='light'||v==='dark')t=v}}catch(e){}" +
    "try{document.documentElement.setAttribute('data-theme',t)}catch(e){}"
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
