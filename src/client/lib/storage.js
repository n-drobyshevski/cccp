// localStorage under the 'cccp.' prefix, over the kit's createStorage (JSON values, always wrapped).
// A refusal (private window, blocked site data) makes get return null and set return false, and
// available() false, so a control that depends on storage can hide itself.
//
// Two formats live in one browser. Everything the app stores as data (cols, views.v1, fs.closed,
// recent) is JSON, which is also the kit's format: getJson/setJson/remove/available are the kit's.
// Two preferences were always written as BARE strings by earlier builds and are still read that
// way by the pre-paint script and by any older build: 'theme' ("light" | "dark") and 'fs.side'
// ("collapsed" | "open"). The kit's get() would JSON-parse them to null and its set() would write
// them with quotes, so get() and set() here keep the bare form (and get() also unwraps a quoted
// one, which a kit-based writer would leave). Existing users keep their theme and sidebar, and a
// rollback to an older build keeps reading what this one writes.
import { createStorage } from "@gas-kit/client/storage.js";

const PREFIX = "cccp.";

/** @type {ReturnType<typeof createStorage> | null} */
let kit = null;
const store = () => kit || (kit = createStorage(PREFIX));

/** Test seam: forget the kit storage, so the next call probes the current localStorage. */
export function __resetStorageForTest() {
  kit = null;
}

/** @returns {Storage | null} */
function ls() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function available() {
  return store().available;
}

/** A bare-string preference, or null. A JSON-quoted string is unwrapped. */
export function get(key) {
  const s = ls();
  if (!s) return null;
  try {
    const text = s.getItem(PREFIX + key);
    if (text == null) return null;
    if (text.charAt(0) === '"') {
      try { const v = JSON.parse(text); return typeof v === "string" ? v : text; } catch (e) { return text; }
    }
    return text;
  } catch (e) { return null; }
}

/** Write a bare-string preference. Returns false when storage refuses. */
export function set(key, value) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(PREFIX + key, String(value)); return true; } catch (e) { return false; }
}

export function remove(key) {
  return store().remove(key);
}

export function getJson(key, fallback) {
  const v = store().get(key);
  return v == null ? (fallback === undefined ? null : fallback) : v;
}

export function setJson(key, value) {
  return store().set(key, value);
}
