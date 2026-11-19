// Extracted from the author's production Apps Script apps; adapted.
// The cached core payload carries nothing per viewer: no viewer, role, email, serviceUrl or
// today key at any depth, and no string value that looks like an email address. The scan reads
// the payload as JSON data would be read: plain objects, arrays, and (as an extra) Map and Set.
import { wire } from "./_util.js";

// A key is forbidden when its words contain a forbidden key's words in order, split on camelCase,
// underscores, dashes and digits: viewerEmail, userRole, user_role and isViewer all hit, and so do plurals of the last word
// (roles, userRoles, viewers, emails) but not a plural in the middle (rolesCount). List the
// app's own role flags (isOwner, canEdit) in forbiddenKeys; the defaults include the common ones.
export const DEFAULT_FORBIDDEN_KEYS = ["viewer", "role", "email", "serviceUrl", "today", "isOwner", "isAdmin", "canEdit"];

/** Lower-case words of a key. @param {string} k */
const words = (k) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());

/**
 * True when needle appears as a contiguous run in hay. The key's last word may carry a plural
 * "s" (roles, viewers, emails hit), but a word in the middle may not (rolesCount passes).
 * @param {string[]} hay @param {string[]} needle
 */
function hasRun(hay, needle) {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w || (i + j === hay.length - 1 && j === needle.length - 1 && hay[i + j] === w + "s"))) return true;
  }
  return false;
}
const EMAIL_RE = /[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g;
// A file name such as icon@2x.png is not an address.
const ASSET_EXT = /^(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|woff2?|ttf|otf|map)$/i;

/** @param {string} s */
function looksLikeEmail(s) {
  for (const m of s.matchAll(EMAIL_RE)) {
    const tld = m[0].slice(m[0].lastIndexOf(".") + 1);
    if (!ASSET_EXT.test(tld)) return true;
  }
  return false;
}

/**
 * @param {{ core: unknown, forbiddenKeys?: string[] }} opts
 * @returns {string[]} violations, each with the path of the offending key or value
 */
export function check({ core, forbiddenKeys = DEFAULT_FORBIDDEN_KEYS }) {
  const forbidden = forbiddenKeys.map(words);
  /** @type {string[]} */ const bad = [];
  const seen = new Set();
  /** @param {any} v @param {string} path */
  const walk = (v, path) => {
    if (typeof v === "string") {
      if (looksLikeEmail(v)) bad.push(path + " holds an email-like value");
    } else if (v && typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);
      const entries = Array.isArray(v) ? v.entries() : v instanceof Map ? v.entries() : v instanceof Set ? [...v].map((x, i) => [i, x]) : Object.entries(v);
      for (const [k, child] of entries) {
        const p = path + (Array.isArray(v) || v instanceof Set ? "[" + String(k) + "]" : "." + String(k));
        if (typeof k === "string" && !(v instanceof Set) && forbidden.some((f) => hasRun(words(k), f))) bad.push(p + " is a per-viewer key");
        if (typeof k === "string" && looksLikeEmail(k)) bad.push(p + " is keyed by an email-like value");
        walk(child, p);
      }
    }
  };
  walk(core, "core");
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "viewer-free core", () => check(opts));
}
