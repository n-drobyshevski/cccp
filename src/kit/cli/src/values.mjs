// The values `create` needs, their defaults and their validation.
import { UsageError } from "./args.mjs";

/** The placeholders the template ships with. */
export const TEMPLATE = { product: "Acme Register", prefix: "acme.", cachePrefix: "acme", accent: "#2a4fb5" };

/**
 * @typedef {object} Values
 * @property {string} name a slug: the package name
 * @property {string} product the display name
 * @property {string} prefix localStorage prefix, ends in a dot
 * @property {string} accent #rrggbb
 * @property {"list" | "org"} access
 * @property {boolean} confidential the app holds confidential data (dataClass "confidential")
 * @property {"none" | "sheet"} source
 * @property {string} tz an IANA zone
 * @property {boolean} e2e
 * @property {boolean} git
 */

/** @param {string} v @returns {string | null} */
export function checkName(v) {
  return /^[a-z][a-z0-9-]*$/.test(v) && v.length <= 60 ? null : "name must be a slug (lowercase letters, digits and hyphens, starting with a letter)";
}
/** @param {string} v @returns {string | null} */
export function checkProduct(v) {
  if (!v.trim() || v.length > 60) return "product must be 1 to 60 characters";
  if (/["'`\\<>&]/.test(v) || v.includes("//") || /[\u0000-\u001f]/.test(v)) return "product must not contain quotes, backticks, backslashes, angle brackets, ampersands, a double slash or control characters";
  if (v !== v.trim()) return "product must not start or end with a space";
  return null;
}
/** @param {string} v @returns {string | null} */
export function checkPrefix(v) {
  return /^[a-z][a-z0-9-]*\.$/.test(v) ? null : "prefix must look like acme. (lowercase, digits, hyphens, ending in a dot)";
}
/** @param {string} v @returns {string | null} */
export function checkAccent(v) {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? null : "accent must be a #rrggbb colour";
}
/** @param {string} v @returns {string | null} */
export function checkAccess(v) {
  return v === "list" || v === "org" ? null : "access must be list or org";
}
/** A yes or no answer, as the confidential prompt takes it. @param {string} v @returns {string | null} */
export function checkYesNo(v) {
  return /^(y|yes|n|no)$/i.test(v.trim()) ? null : "answer yes or no";
}
/** @param {string | boolean | undefined} v */
const truthy = (v) => v === true || (typeof v === "string" && /^(y|yes|true)$/i.test(v.trim()));
/** @param {string} v @returns {string | null} */
export function checkSource(v) {
  return v === "none" || v === "sheet" ? null : "source must be none or sheet";
}
/** @param {string} v @returns {string | null} */
export function checkTz(v) {
  if (!/^[A-Z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(v)) return "tz must be an IANA zone such as UTC or Europe/Berlin";
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return null;
  } catch {
    return "tz is not a known IANA zone: " + v;
  }
}

export const CHECKS = { name: checkName, product: checkProduct, prefix: checkPrefix, accent: checkAccent, access: checkAccess, source: checkSource, tz: checkTz };

/** "my-app" to "My App". @param {string} slug */
export function titleFromSlug(slug) {
  return slug.split("-").filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

/** The slug a directory name suggests. @param {string} base */
export function slugFromDir(base) {
  const s = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "");
  return s || "register-app";
}

/**
 * Defaults for every value the flags left out.
 * @param {Record<string, string | boolean>} flags
 * @param {string} dirBase the target directory's base name
 * @returns {Values}
 */
export function resolveValues(flags, dirBase) {
  const str = (/** @type {string} */ k) => (typeof flags[k] === "string" ? /** @type {string} */ (flags[k]) : undefined);
  const name = str("name") ?? slugFromDir(dirBase);
  /** @type {Values} */
  const v = {
    name,
    product: str("product") ?? titleFromSlug(name),
    prefix: str("prefix") ?? name.replace(/-/g, "") + ".",
    accent: (str("accent") ?? TEMPLATE.accent).toLowerCase(),
    access: /** @type {"list" | "org"} */ (str("access") ?? "list"),
    confidential: truthy(flags["confidential"]),
    source: /** @type {"none" | "sheet"} */ (str("source") ?? "sheet"),
    tz: str("tz") ?? "UTC",
    e2e: flags["e2e"] !== false,
    git: flags["git"] === true,
  };
  return v;
}

/**
 * Throws a UsageError naming every invalid value.
 * @param {Values} v
 */
export function validateValues(v) {
  /** @type {string[]} */
  const bad = [];
  for (const [k, check] of Object.entries(CHECKS)) {
    const why = check(/** @type {string} */ (/** @type {Record<string, unknown>} */ (v)[k]));
    if (why) bad.push(why);
  }
  if (v.confidential && v.access !== "list") bad.push("a confidential app admits listed people only: leave --access out or use --access list");
  if (bad.length) throw new UsageError(bad.join("; "));
}
