// Extracted from the author's production Apps Script apps; adapted.
// localStorage, always wrapped, always under the app's prefix. A refusal (private window,
// blocked site data) makes get return null and set return false and flips `available` to
// false, so a control that depends on storage can hide itself. A single failed write (a quota
// error on a large cached payload) returns false but does NOT flip `available`: that flag
// answers only "is storage reachable at all", so personal controls survive a big swr payload.
// Values are JSON, except under the keys named in `raw`: those hold a plain string as written,
// for an app moved onto the kit whose existing keys (a theme "dark", say) were never JSON. A raw
// key's get returns the stored text, and its set takes only a string.

/**
 * @param {string} prefix the app's key prefix, for example "acme."
 * @param {{ raw?: string[] | true }} [opts] raw: keys (or every key, with true) whose values are plain strings, not JSON
 * @returns {{
 *   get: (key: string) => any,
 *   set: (key: string, value: unknown) => boolean,
 *   remove: (key: string) => boolean,
 *   readonly available: boolean,
 * }}
 */
export function createStorage(prefix, opts = {}) {
  const p = String(prefix || "");
  const rawOpt = opts.raw;
  const rawKeys = Array.isArray(rawOpt) ? new Set(rawOpt.map(String)) : null;
  /** @param {string} key */
  const isRaw = (key) => rawOpt === true || (rawKeys !== null && rawKeys.has(key));
  let ok = true;

  /** @returns {Storage | null} */
  function ls() {
    try {
      const s = /** @type {any} */ (globalThis).localStorage;
      if (s) return s;
    } catch (e) { /* refused */ }
    ok = false;
    return null;
  }

  // Probe once, so a control can decide to hide before it is ever used.
  const s0 = ls();
  if (s0) {
    try {
      s0.setItem(p + "probe", "1");
      s0.removeItem(p + "probe");
    } catch (e) { ok = false; }
  }

  // A SecurityError means storage is blocked now (site data cleared or refused mid-session):
  // flip the flag so a control that depends on storage hides. A quota error does not.
  /** @param {any} e */
  const refused = (e) => { if (e && e.name === "SecurityError") ok = false; };

  return {
    get(key) {
      const s = ls();
      if (!s) return null;
      try {
        const text = s.getItem(p + key);
        if (text == null) return null;
        return isRaw(key) ? text : JSON.parse(text);
      } catch (e) {
        refused(e);
        return null;
      }
    },
    set(key, value) {
      const s = ls();
      if (!s) return false;
      try {
        if (isRaw(key) && typeof value !== "string") return false;
        const text = isRaw(key) ? /** @type {string} */ (value) : JSON.stringify(value);
        if (text === undefined) return false;
        s.setItem(p + key, text);
        return true;
      } catch (e) {
        refused(e);
        return false;
      }
    },
    remove(key) {
      const s = ls();
      if (!s) return false;
      try { s.removeItem(p + key); return true; } catch (e) { refused(e); return false; }
    },
    get available() { return ok; },
  };
}
