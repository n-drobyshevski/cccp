// Extracted from the author's production Apps Script apps; adapted.
// Note: under HtmlService the app runs in a nested iframe, so the hash does not reach the top URL
// and deep links do not survive a reload; scriptUrl.js is the opt-in google.script.history/url bridge.
// URL helpers. A literal double slash is banned in served strings, so addresses are joined
// from parts, and hash state is read and written through these functions.
import { attrs, html, isSafeUrl, linkAttrs } from "./html.js";

/**
 * Join URL parts with single slashes. A scheme part ending in a colon followed by an empty part
 * gives the double slash: joinUrl("https:", "", host) is the scheme, two slashes and the host.
 * Other empty parts are dropped; surrounding slashes of a part are trimmed.
 * @param {...unknown} parts
 * @returns {string}
 */
export function joinUrl(...parts) {
  /** @type {string[]} */
  const out = [];
  parts.forEach((p, i) => {
    const s = String(p == null ? "" : p);
    if (i === 0) { out.push(s.replace(/\/+$/, "")); return; }
    if (s === "") {
      const prev = out[out.length - 1];
      if (out.length === 1 && prev && prev.charAt(prev.length - 1) === ":") out.push("");
      return;
    }
    const t = s.replace(/^\/+|\/+$/g, "");
    if (t) out.push(t);
  });
  return out.join("/");
}

/**
 * An anchor that opens in the top window (the app lives in a sandboxed frame), with
 * rel="noopener noreferrer". Only absolute http(s) and mailto links that pass isSafeUrl become
 * anchors; anything else is shown as plain text.
 * @param {string} href
 * @param {unknown} label
 */
export function topLink(href, label) {
  const ok = isSafeUrl(href) && /^(https?:|mailto:)/i.test(String(href));
  if (!ok) return html`<span>${label}</span>`;
  return html`<a ${attrs(linkAttrs(href))}>${label}</a>`;
}

/**
 * Parse a hash such as #/item/42?tab=risk into its path and query. The query is a
 * null-prototype object: only the keys in the hash are in it (so query.constructor is
 * undefined unless the hash names it), and __proto__ is an ordinary key.
 * @param {string} hash
 * @returns {{ path: string, query: Record<string, string> }}
 */
export function parseHash(hash) {
  const body = String(hash || "").replace(/^#\/?/, "");
  const q = body.indexOf("?");
  const path = q < 0 ? body : body.slice(0, q);
  /** @type {Record<string, string>} */
  const query = Object.create(null);
  if (q >= 0) {
    for (const pair of body.slice(q + 1).split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
      if (k) query[k] = eq < 0 ? "" : safeDecode(pair.slice(eq + 1));
    }
  }
  return { path, query };
}

/** @param {string} s */
function safeDecode(s) {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { return s; }
}

/**
 * Build a hash from a path and a query. Empty, null and undefined values are dropped.
 * @param {string} path
 * @param {Record<string, unknown>} [query]
 * @returns {string}
 */
export function buildHash(path, query) {
  const p = String(path || "").replace(/^\/+/, "");
  const parts = Object.keys(query || {})
    .filter((k) => { const v = /** @type {any} */ (query)[k]; return v != null && v !== "" && v !== false; })
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(/** @type {any} */ (query)[k])));
  return "#/" + p + (parts.length ? "?" + parts.join("&") : "");
}

/** @returns {any} */
function loc() {
  try { return /** @type {any} */ (globalThis).location || null; } catch (e) { return null; }
}

/**
 * The query of the current hash as an object ({} when there is no location).
 * @returns {Record<string, string>}
 */
export function hashParams() {
  const l = loc();
  return l ? parseHash(l.hash).query : Object.create(null);
}

/**
 * Write the query of the current hash (URL-backed UI state), keeping the path. Nothing is
 * written when the result equals the current hash. Uses history.replaceState so the Back
 * button is not flooded; pass { push: true } to add a history entry.
 * @param {Record<string, unknown>} obj
 * @param {{ push?: boolean }} [opts]
 * @returns {boolean} true when the hash changed
 */
export function setHashParams(obj, opts) {
  const l = loc();
  if (!l) return false;
  const next = buildHash(parseHash(l.hash).path, obj);
  if (next === l.hash) return false;
  try {
    const h = /** @type {any} */ (globalThis).history;
    if (h && typeof h.replaceState === "function" && !(opts && opts.push)) h.replaceState(null, "", next);
    else l.hash = next;
  } catch (e) {
    l.hash = next;
  }
  return true;
}
