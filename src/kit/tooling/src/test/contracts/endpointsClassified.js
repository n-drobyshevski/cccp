// Extracted from the author's production Apps Script apps; adapted.
// Every export of api.ts is a key of the roles table, and the table has no extra keys.
import { exportedNames } from "../../build/guards.mjs";
import { stripComments, wire } from "./_util.js";

export const ROLES = ["viewer", "admin", "owner"];

/**
 * Endpoint names exported by an api.ts text, read with guards.mjs exportedNames so the contract
 * and the build guard agree on what an endpoint is: export function, export async function and
 * export const|let|var. Type-only exports are ignored, as is a brace list of types only. Any other
 * export form (default, class, enum, namespace, a value brace list) cannot be matched to a
 * delegator by name; each such line comes back in `other` instead of being skipped.
 * @param {string} apiTs
 * @returns {{ names: string[], other: string[] }}
 */
export function apiExports(apiTs) {
  /** @type {string[]} */ const names = [];
  /** @type {string[]} */ const other = [];
  for (const line of stripComments(apiTs).split("\n")) {
    if (!/^export\b/.test(line)) continue;
    const brace = /^export\s*\{([^}]*)\}/.exec(line);
    if (brace && brace[1].trim() && brace[1].split(",").every((p) => !p.trim() || /^type\s/.test(p.trim()))) continue;
    try {
      names.push(...exportedNames(line));
    } catch {
      other.push(line.trim());
    }
  }
  return { names, other };
}

/**
 * @param {{ apiTs: string, rolesTable: Record<string, unknown> | string[], roles?: string[] }} opts
 *   roles: the role names a table value must be one of (default viewer, admin, owner); not checked
 *   when rolesTable is an array of names
 * @returns {string[]} violations
 */
export function check({ apiTs, rolesTable, roles = ROLES }) {
  const { names, other } = apiExports(apiTs);
  const keys = Array.isArray(rolesTable) ? rolesTable : Object.keys(rolesTable);
  /** @type {string[]} */ const bad = [];
  for (const n of names) if (!keys.includes(n)) bad.push("api.ts exports " + n + " but the roles table does not classify it");
  for (const k of keys) if (!names.includes(k)) bad.push("roles table lists " + k + " but api.ts does not export it");
  for (const o of other) bad.push("api.ts has an export the check cannot classify by name: " + o);
  if (!Array.isArray(rolesTable)) {
    for (const [k, v] of Object.entries(rolesTable)) {
      if (v === undefined || v === null || v === "") bad.push("roles table entry " + k + " has no role");
      else if (typeof v !== "string" || !roles.includes(v)) bad.push("roles table entry " + k + " has an unknown role " + JSON.stringify(v) + " (expected " + roles.join(", ") + ")");
    }
  }
  return bad;
}

/** Register the contract. @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "endpoints classified", () => check(opts));
}
