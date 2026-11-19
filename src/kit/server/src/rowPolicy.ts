// Restricted columns and rows by role (never per viewer). One projection, applied on the server
// to every path that sends rows (list, item, boot, export), so a restricted value never reaches a
// browser that may not see it: hiding it in the client is not a control.
//
//   const POLICY: RowPolicy<Item> = { columns: { cost: "admin", notes: "owner" }, rows: (r, role) => role !== "viewer" || !r.private };
//   const rows = projectRows(all, access.role(), POLICY);
//
// A column absent from `columns` is visible to every role. A minimum role that is not one of the
// three never matches, so a typo hides the column (fail closed). A null role sees nothing. The
// input is never mutated: a row that loses a key is a shallow copy (own enumerable properties).
//
// SHAPES IT DOES NOT UNDERSTAND THROW (fail closed), rather than passing rows through whole: a
// policy that is not a plain object, a `rows` that is not a function, a `columns` that is not a
// plain object (an array or a Map), and, when the role may not see some column, a row that is an
// array (packed rows from encodeRows: project the row objects first, or decodeRows) or anything
// but a plain object. The same array comes back uncopied only when the policy restricts nothing
// for the role.

import { roleAllows, type Role } from "./roles";

export interface RowPolicy<R> {
  /** The lowest role that may see each restricted column key. */
  columns?: Record<string, Role>;
  /** Keep a row for this role. A throw propagates (nothing is returned). */
  rows?: (row: R, role: Role) => boolean;
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Throws a TypeError for a policy shape this module does not understand. */
function checkPolicy(policy: unknown): asserts policy is RowPolicy<unknown> {
  if (!isPlainObject(policy)) throw new TypeError("rowPolicy: the policy must be a plain object { columns?, rows? }.");
  if (policy.rows !== undefined && typeof policy.rows !== "function") {
    throw new TypeError("rowPolicy: policy.rows must be a function (row, role) => boolean.");
  }
  if (policy.columns !== undefined && !isPlainObject(policy.columns)) {
    throw new TypeError("rowPolicy: policy.columns must be a plain object { columnKey: minimumRole } (not an array or a Map).");
  }
}

/** The column keys a role may not see. */
function hiddenFor(role: Role, policy: RowPolicy<unknown>): string[] {
  const cols = policy.columns;
  if (!cols) return [];
  return Object.keys(cols).filter((k) => !roleAllows(role, cols[k]!));
}

/** Throws unless a row is a plain object (the only shape a hidden key can be removed from). */
function checkRow(row: unknown): void {
  if (Array.isArray(row)) {
    throw new TypeError("projectRows: a row is an array (packed rows?). Project the row objects before encodeRows, or decodeRows first.");
  }
  if (!isPlainObject(row)) throw new TypeError("projectRows: every row must be a plain object when a column is hidden for the role.");
}

/** The keys a role may see, in the order given. Throws a TypeError for a malformed policy. */
export function visibleColumns<R>(keys: readonly string[], role: Role | null, policy: RowPolicy<R> = {}): string[] {
  checkPolicy(policy);
  if (!roleAllows(role, "viewer")) return [];
  const cols = policy.columns;
  return keys.filter((k) => !cols || !has(cols, k) || roleAllows(role, cols[k]!));
}

/**
 * The rows this role may see, without the column keys it may not see. When the policy restricts
 * nothing for this role (an empty policy, or the owner) the same array comes back, no copy; a
 * null role gets []. A malformed policy, a rows argument that is not an array, and (when a column
 * is hidden for the role) a row that is not a plain object throw a TypeError.
 */
export function projectRows<R extends object>(rows: readonly R[], role: Role | null, policy: RowPolicy<R> = {}): R[] {
  checkPolicy(policy);
  if (!roleAllows(role, "viewer")) return [];
  if (!Array.isArray(rows)) {
    throw new TypeError("projectRows: rows must be an array of row objects (for packed rows from encodeRows, decodeRows first).");
  }
  const r = role as Role;
  const hidden = hiddenFor(r, policy as RowPolicy<unknown>);
  const keep = policy.rows ?? null;
  if (!keep && hidden.length === 0) return rows as R[];
  const out: R[] = [];
  for (const row of rows) {
    if (hidden.length) checkRow(row);
    if (keep && keep(row, r) !== true) continue;
    if (hidden.length === 0 || !hidden.some((k) => has(row, k))) {
      out.push(row);
      continue;
    }
    const copy = { ...row } as Record<string, unknown>;
    for (const k of hidden) delete copy[k];
    out.push(copy as R);
  }
  return out;
}
