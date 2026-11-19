// Extracted from the author's production Apps Script apps; adapted.
//
// The dev server's page flags. Every flag given on the page URL applies to that page load and to
// the RPC calls the page makes (the shim forwards the query string).
//
//   ?as=<email>            the active user
//   ?role=owner|admin|viewer|denied|anonymous   a named identity from dev.config.mjs
//   ?mode=list|org         the access mode property
//   ?nosource              remove the source sheet property
//   ?empty                 the source sheets keep only their header row
//   ?coldcache             clear the script cache before each request
//   ?slow=<ms>             delay every RPC answer
//   ?tz=<IANA zone>        the fake script and sheet time zone

export const ROLE_FLAGS = ["owner", "admin", "viewer", "denied", "anonymous"];
export const SLOW_MAX_MS = 60000;

/**
 * @typedef {object} Flags
 * @property {string | null} as
 * @property {"owner" | "admin" | "viewer" | "denied" | "anonymous" | null} role
 * @property {"list" | "org" | null} mode
 * @property {boolean} nosource
 * @property {boolean} empty
 * @property {boolean} coldcache
 * @property {number} slow
 * @property {string | null} tz
 */

/** A bare flag is on; "0", "false" and "off" turn it off. @param {string | null} v */
function truthy(v) {
  if (v === null) return false;
  return !/^(0|false|off|no)$/i.test(v.trim());
}

/** @param {string} tz */
function validZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize the flags of a URL. Unknown or malformed values read as "not given".
 * @param {URLSearchParams | string} params
 * @returns {Flags}
 */
export function parseFlags(params) {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const as = (p.get("as") ?? "").trim().toLowerCase();
  const role = (p.get("role") ?? "").trim().toLowerCase();
  const mode = (p.get("mode") ?? "").trim().toLowerCase();
  const slowRaw = Number.parseInt(p.get("slow") ?? "", 10);
  const tz = (p.get("tz") ?? "").trim();
  return {
    as: as || null,
    role: /** @type {Flags["role"]} */ (ROLE_FLAGS.includes(role) ? role : null),
    mode: mode === "list" || mode === "org" ? mode : null,
    nosource: truthy(p.get("nosource")),
    empty: truthy(p.get("empty")),
    coldcache: truthy(p.get("coldcache")),
    slow: Number.isFinite(slowRaw) && slowRaw > 0 ? Math.min(slowRaw, SLOW_MAX_MS) : 0,
    tz: tz && validZone(tz) ? tz : null,
  };
}
