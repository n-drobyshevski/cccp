// Extracted from the author's production Apps Script apps; adapted.
// DOM-free model for the access editor: address parsing and validation, case-blind dedupe,
// an owner that can never be removed, the access mode, a diff for the save and a check that
// the server kept what was sent. The server stays the authority; this keeps the draft honest.

/** The access modes: a listed set of people, or everyone at the owner's domain. */
export const ACCESS_MODES = ["list", "org"];

/**
 * The most addresses the editor lets one list hold. It is deliberately below the server's
 * ACCESS_MAX_ENTRIES (500): a draft this long is already unwieldy to review in a list, and the
 * server stays the authority and still enforces its own, wider cap and byte limit.
 */
export const MAX_ENTRIES = 200;

// A plain local@domain, as the server accepts it: one @, a non-empty local part (an apostrophe
// and a plus are fine there), a local part that does not end in a dot, a domain of non-empty dot-separated labels (at least two), no whitespace or delimiters.
const EMAIL = /^[^\s@,;<>()"\\]*[^\s@,;<>()"\\.]@[^\s@,;<>()"'\\.]+(\.[^\s@,;<>()"'\\.]+)+$/;

/**
 * Trim and lower-case an address.
 * @param {unknown} s
 * @returns {string}
 * @internal
 */
export function normEmail(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

/**
 * @param {unknown} s
 * @returns {boolean}
 * @internal
 */
export function isEmail(s) {
  const t = normEmail(s);
  return t.length <= 254 && EMAIL.test(t);
}

/**
 * The domain part of an address, or "".
 * @param {unknown} s
 * @internal
 */
export function domainOf(s) {
  const t = normEmail(s);
  const i = t.lastIndexOf("@");
  return i > 0 ? t.slice(i + 1) : "";
}

/**
 * Split pasted text on commas, semicolons, spaces and newlines into normalised entries.
 * Angle-bracket forms such as "Name <a@b.co>" yield the address.
 * @param {unknown} text
 * @returns {string[]}
 * @internal
 */
export function parseEmails(text) {
  return String(text == null ? "" : text)
    .replace(/<([^<>]*)>/g, " $1 ")
    .split(/[\s,;]+/)
    .map(normEmail)
    .filter(Boolean);
}

/**
 * Normalise a list: lower-case, trim, drop blanks, drop repeats (first wins, order kept).
 * @param {unknown} list
 * @returns {string[]}
 * @internal
 */
export function normalizeList(list) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const e = normEmail(x);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * Normalise a mode: exactly "list" or "org", anything else reads as the default.
 * @param {unknown} raw
 * @param {"list"|"org"} [fallback]
 * @returns {"list"|"org"}
 * @internal
 */
export function normalizeMode(raw, fallback) {
  const t = String(raw == null ? "" : raw).trim();
  return t === "org" ? "org" : t === "list" ? "list" : fallback || "list";
}

/**
 * @typedef {{users: string[], admins: string[], mode: "list"|"org", owner?: string}} AccessDraft
 */

/**
 * A draft from stored values: normalised, with the owner first in the users list and absent
 * from the admins list (the owner outranks an admin).
 * @param {{owner?: string, users?: unknown, admins?: unknown, mode?: unknown}} src
 * @returns {AccessDraft}
 * @internal
 */
export function createDraft(src) {
  const owner = normEmail(src && src.owner);
  const users = normalizeList(src && src.users).filter((e) => e !== owner);
  const admins = normalizeList(src && src.admins).filter((e) => e !== owner);
  /** @type {AccessDraft} */
  const d = { users: owner ? [owner].concat(users) : users, admins, mode: normalizeMode(src && src.mode) };
  if (owner) d.owner = owner;
  return d;
}

/**
 * Add the addresses in `text` to one list. Invalid, repeated and (for admins) owner entries are
 * rejected with a reason; the rest are appended. Returns a NEW draft.
 * @param {AccessDraft} draft
 * @param {"users"|"admins"} list
 * @param {unknown} text
 * @param {string} [owner]
 * @returns {{draft: AccessDraft, added: string[], rejected: Array<{value: string, reason: string}>}}
 * @internal
 */
export function addEmails(draft, list, text, owner) {
  const o = normEmail(owner || draft.owner);
  const cur = draft[list].slice();
  /** @type {string[]} */
  const added = [];
  /** @type {Array<{value: string, reason: string}>} */
  const rejected = [];
  for (const e of parseEmails(text)) {
    if (!isEmail(e)) rejected.push({ value: e, reason: "is not a valid email address" });
    else if (cur.indexOf(e) >= 0) rejected.push({ value: e, reason: "is already in the list" });
    else if (list === "admins" && e === o) rejected.push({ value: e, reason: "is the owner, who already has full access" });
    else if (cur.length >= MAX_ENTRIES) rejected.push({ value: e, reason: "does not fit: the list is full" });
    else { cur.push(e); added.push(e); }
  }
  return { draft: Object.assign({}, draft, { [list]: cur }), added, rejected };
}

/**
 * Remove one address. The owner can never be removed from the users list: the draft comes
 * back unchanged and `ok` is false. The owner is the `owner` argument, else the one the draft
 * carries (createDraft stores it), so pass one of them.
 * @param {AccessDraft} draft
 * @param {"users"|"admins"} list
 * @param {string} email
 * @param {string} [owner]
 * @returns {{draft: AccessDraft, ok: boolean, reason?: string}}
 * @internal
 */
export function removeEmail(draft, list, email, owner) {
  const e = normEmail(email);
  const o = normEmail(owner || draft.owner);
  if (list === "users" && o && e === o) return { draft, ok: false, reason: "The owner cannot be removed" };
  if (draft[list].indexOf(e) < 0) return { draft, ok: false, reason: "Not in the list" };
  return { draft: Object.assign({}, draft, { [list]: draft[list].filter((x) => x !== e) }), ok: true };
}

/**
 * @param {AccessDraft} draft
 * @param {"list"|"org"} mode
 * @returns {AccessDraft}
 * @internal
 */
export function setMode(draft, mode) {
  return Object.assign({}, draft, { mode: normalizeMode(mode, draft.mode) });
}

/**
 * Problems that must block a save, as messages. An empty array means the draft may be saved.
 * @param {AccessDraft} draft
 * @param {string} [owner]
 * @returns {string[]}
 * @internal
 */
export function draftProblems(draft, owner) {
  const o = normEmail(owner || draft.owner);
  /** @type {string[]} */
  const out = [];
  if (o && draft.users.indexOf(o) < 0) out.push("The owner must stay in the users list");
  if (o && draft.admins.indexOf(o) >= 0) out.push("The owner is not listed as an admin");
  for (const k of /** @type {const} */ (["users", "admins"])) {
    const bad = draft[k].filter((e) => !isEmail(e));
    if (bad.length) out.push(bad.length + " invalid address" + (bad.length === 1 ? "" : "es") + " in " + k);
    if (draft[k].length > MAX_ENTRIES) out.push("The " + k + " list is over " + MAX_ENTRIES + " entries");
  }
  return out;
}

/**
 * Addresses whose domain differs from the owner's: worth a second look, not an error.
 * @param {string[]} list
 * @param {string} [owner]
 * @returns {string[]}
 * @internal
 */
export function foreignAddresses(list, owner) {
  const d = domainOf(owner);
  return d ? (list || []).filter((e) => domainOf(e) !== d) : [];
}

/**
 * What a save would change.
 * @param {AccessDraft} base
 * @param {AccessDraft} draft
 * @returns {{users: {added: string[], removed: string[]}, admins: {added: string[], removed: string[]}, mode: {from: string, to: string}|null, count: number}}
 * @internal
 */
export function accessDiff(base, draft) {
  const one = (/** @type {string[]} */ a, /** @type {string[]} */ b) => ({
    added: b.filter((x) => a.indexOf(x) < 0),
    removed: a.filter((x) => b.indexOf(x) < 0),
  });
  const users = one(base.users, draft.users);
  const admins = one(base.admins, draft.admins);
  const mode = base.mode !== draft.mode ? { from: base.mode, to: draft.mode } : null;
  return { users, admins, mode, count: users.added.length + users.removed.length + admins.added.length + admins.removed.length + (mode ? 1 : 0) };
}

/**
 * The payload of a save: only the parts that changed. Admins and mode are owner-only on the
 * server; the caller decides which of them to send.
 * @param {AccessDraft} base
 * @param {AccessDraft} draft
 * @returns {{users?: string[], admins?: string[], mode?: "list"|"org"}}
 * @internal
 */
export function accessPatch(base, draft) {
  const d = accessDiff(base, draft);
  /** @type {{users?: string[], admins?: string[], mode?: "list"|"org"}} */
  const out = {};
  if (d.users.added.length || d.users.removed.length) out.users = draft.users.slice();
  if (d.admins.added.length || d.admins.removed.length) out.admins = draft.admins.slice();
  if (d.mode) out.mode = draft.mode;
  return out;
}

/**
 * The addresses that were sent but are not in what the server stored (case and whitespace
 * blind), so a save is never reported as complete when the server dropped an address.
 * @param {unknown} sent
 * @param {unknown} stored
 * @returns {string[]}
 * @internal
 */
export function notKept(sent, stored) {
  const have = new Set(normalizeList(stored));
  return normalizeList(sent).filter((e) => !have.has(e));
}
