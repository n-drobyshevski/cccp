// Light and dark. The choice lives on <html data-theme> and in localStorage 'cccp.theme'; the
// pre-paint script in index.html applies a stored choice before first paint, else light (the
// default theme). With no stored choice the Display default applies; 'system' leaves the attribute off so the media query in
// tokens.css decides.
import * as storage from "../lib/storage.js";

const subs = new Set();

const root = () => document.documentElement;

function systemDark() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { return false; }
}

function apply(theme) {
  if (theme === "light" || theme === "dark") root().setAttribute("data-theme", theme);
  else root().removeAttribute("data-theme");
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
  const stored = storage.get("theme");
  if (stored === "light" || stored === "dark") apply(stored);
  else apply(displayDefault === "light" || displayDefault === "dark" ? displayDefault : "system");
  return effective();
}

/** Flip light and dark and remember it. Works without storage, for the session only. */
export function toggle() {
  const next = effective() === "dark" ? "light" : "dark";
  storage.set("theme", next);
  apply(next);
  return next;
}

export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
