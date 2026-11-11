// localStorage, always wrapped. Every key is prefixed 'cccp.'. A refusal (private window, blocked
// site data) makes get return null and set return false, so a control that depends on storage
// can hide itself with available().
const PREFIX = "cccp.";

function ls() {
  try { return window.localStorage || null; } catch (e) { return null; }
}

export function available() {
  const s = ls();
  if (!s) return false;
  try {
    s.setItem(PREFIX + "probe", "1");
    s.removeItem(PREFIX + "probe");
    return true;
  } catch (e) { return false; }
}

export function get(key) {
  const s = ls();
  if (!s) return null;
  try { return s.getItem(PREFIX + key); } catch (e) { return null; }
}

export function set(key, value) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(PREFIX + key, String(value)); return true; } catch (e) { return false; }
}

export function remove(key) {
  const s = ls();
  if (!s) return false;
  try { s.removeItem(PREFIX + key); return true; } catch (e) { return false; }
}

export function getJson(key, fallback) {
  const raw = get(key);
  if (raw == null) return fallback === undefined ? null : fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback === undefined ? null : fallback; }
}

export function setJson(key, value) {
  let text;
  try { text = JSON.stringify(value); } catch (e) { return false; }
  return set(key, text);
}
