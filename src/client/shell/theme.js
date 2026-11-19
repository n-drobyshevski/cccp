// Light and dark. The choice lives on <html data-theme> and in localStorage 'cccp.theme' (a bare
// string, see lib/storage.js); the pre-paint script in index.html applies a stored choice before
// first paint, else light (the default theme). With no stored choice the Display default applies;
// 'system' leaves the attribute off so the media query in tokens.css decides. Reading, writing and
// applying the choice are the kit's getTheme and setTheme; this module adds what is the app's:
// the Display default, the light/dark flip and the change subscribers.
import { getTheme, setTheme } from "@gas-kit/client/theme.js";
import * as storage from "../lib/storage.js";

const subs = new Set();

const root = () => document.documentElement;

function systemDark() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { return false; }
}

function apply(mode) {
  // No `storage` option: applying must not write. The kit's "auto" is cccp's 'system'.
  setTheme(mode === "light" || mode === "dark" ? mode : "auto", { root: root() });
  for (const fn of Array.from(subs)) fn(effective());
}

/** 'light' or 'dark', as drawn right now. */
export function effective() {
  const t = root().getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return systemDark() ? "dark" : "light";
}

/** Apply the stored choice, else the Display default ('system' | 'light' | 'dark'). */
export function init(displayDefault) {
  const stored = getTheme(storage);
  if (stored !== "auto") apply(stored);
  else apply(displayDefault === "light" || displayDefault === "dark" ? displayDefault : "system");
  return effective();
}

/** Flip light and dark and remember it. Works without storage, for the session only. */
export function toggle() {
  const next = effective() === "dark" ? "light" : "dark";
  setTheme(next, { storage, root: root() });
  for (const fn of Array.from(subs)) fn(effective());
  return next;
}

export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
