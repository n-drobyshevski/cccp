// Extracted from the author's production Apps Script apps; adapted.
// Who may use the deployed web app, and in which role.
//
// The deployment's own fence is "Anyone within <domain>". This narrows it to the addresses in
// ALLOWED_USERS and ALLOWED_ADMINS, or, in org mode, to every account on the owner's domain.
// The active user's email is only visible to same-domain visitors under USER_DEPLOYING; anybody
// else reads as "" and is DENIED. The manifest must pin executeAs USER_DEPLOYING: under
// "execute as the user accessing" the effective user is the visitor, and every caller would
// pass as the owner.
//
// FAIL CLOSED. An unset, empty or unparseable list admits nobody, except the owner, who is
// allowed by IDENTITY rather than by a list. An unset ACCESS_MODE reads as the app's
// modeDefault; a set but malformed one reads as "list".
//
// Decision order: misconfigured, anonymous, owner, admin, listed, org, not-listed.
//
// OWNER PIN. A private function run in the Apps Script editor stores the deploying account's
// address in OWNER_EMAIL (pinOwner); the deployer may type the property by hand instead. From
// then on, an execution whose effective user is anyone else (a deployment set to "execute as the
// user accessing", or one redeployed by another account) is denied for EVERY caller as
// "misconfigured". With requireOwnerPin, no pin denies everyone too. Never call pinOwner from a
// public global: under "execute as the user accessing" every visitor's active and effective
// addresses are equal, so the first caller of a web-reachable pin would become the owner.
//
// Storage: each list is one Script Property holding a JSON array of lowercase addresses, under
// PROP_MAX_BYTES. A plain delimited value (one address per line, or comma separated, as typed
// into the Script Properties editor during setup) is read too, and rewritten as JSON on the
// next save.
//
// The guards belong in the app's doGet (deniedPage) and in run() (the role gate, fed by
// role()): google.script.run reaches top-level globals directly, and the client is never the
// authority.

import { ApiError } from "./envelope";
import { cardPage } from "./page";
import { PROP_MAX_BYTES, propsGeneration, utf8ByteLength } from "./props";
import { executionGeneration } from "./execution";
import type { DenyEnvelope, Role } from "./roles";

export type AccessMode = "list" | "org";

export type AccessReason = "owner" | "admin" | "listed" | "org" | "anonymous" | "not-listed" | "misconfigured";

export interface AccessDecision {
  allowed: boolean;
  /** The caller's role, or null when denied. Listed and org callers are viewers. */
  role: Role | null;
  reason: AccessReason;
  /** The address the app actually saw (trimmed), or "" when the caller could not be identified. */
  email: string;
}

/** The Script Property names. An app may rename them through createAccess({ keys }). */
export const ACCESS_PROP_KEYS = {
  users: "ALLOWED_USERS",
  admins: "ALLOWED_ADMINS",
  mode: "ACCESS_MODE",
  owner: "OWNER_EMAIL",
} as const;

export interface AccessKeys {
  users: string;
  admins: string;
  mode: string;
  /** The owner pin written by pinOwner. */
  owner: string;
}

/** What onChange receives before an access save is written. */
export interface AccessChange {
  kind: "users" | "admins" | "mode";
  /** The saving caller's address. */
  actor: string;
  /** Lists: the addresses the save adds and removes. */
  added?: string[];
  removed?: string[];
  /** Mode: the stored mode and the new one. */
  from?: string;
  to?: string;
}

/** The property store access reads (and, for the save helpers, writes). */
export interface AccessProps {
  get(key: string): string | null;
  set?(key: string, value: string): void;
}

export const ACCESS_MAX_ENTRIES = 500;

// ------------------------------------------------------------------- pure helpers

function normalize(parts: unknown[]): string[] {
  // No prototype: "constructor" or "__proto__" must be an entry (and refused as not an address),
  // never read as already seen and dropped.
  const seen: Record<string, true> = Object.create(null) as Record<string, true>;
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== "string") continue;
    for (const piece of p.split(/[,;\s]+/)) {
      const email = piece.trim().toLowerCase();
      if (!email || seen[email]) continue;
      seen[email] = true;
      out.push(email);
    }
  }
  return out;
}

/**
 * The addresses in a stored list, trimmed, lowercased and deduped.
 *
 * A JSON array is the stored form. Anything else is split on commas, semicolons and
 * whitespace (an address contains none of them), so a list pasted one-per-line or
 * comma-separated parses the same. A value that looks like JSON (starts with "[", "{" or a
 * quote) but does not parse to an array admits nobody.
 */
export function parseAddressList(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (/^[[{"]/.test(s)) {
    try {
      const v: unknown = JSON.parse(s);
      return Array.isArray(v) ? normalize(v) : [];
    } catch {
      return [];
    }
  }
  return normalize([s]);
}

/** The domain of an address (lowercased), or "" when it is not a plain local@domain. */
export function domainOf(email: string | null | undefined): string {
  const e = (email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@") || at === e.length - 1) return "";
  return e.slice(at + 1);
}

/**
 * ACCESS_MODE as stored. Unset or empty is the app's default; exactly "org" or "list" is
 * itself; anything else (a typo, other case) is "list", the narrower mode.
 */
export function parseAccessMode(raw: string | null | undefined, modeDefault: AccessMode = "list"): AccessMode {
  if (raw === null || raw === undefined || raw === "") return modeDefault === "org" ? "org" : "list";
  return raw === "org" ? "org" : "list";
}

export interface DecideInput {
  active: string | null | undefined;
  owner: string | null | undefined;
  users: readonly string[];
  admins: readonly string[];
  mode: AccessMode;
}

/**
 * The decision as a pure function of its inputs:
 *
 *   active ""/null                      deny  (anonymous)
 *   active === owner (both non-empty)   allow (owner), regardless of either list
 *   active in the admins list           allow (admin)
 *   active in the users list            allow (listed)
 *   mode "org" and the caller's domain equals the owner's (both non-empty)
 *                                       allow (org), a viewer, never an admin
 *   otherwise                           deny  (not-listed)
 *
 * Matching is exact after trim and lowercase: an alias is a different string. Admins are
 * allowed by the admins list alone, so editing the users list can never demote one.
 */
export function decideAccess(input: DecideInput): AccessDecision {
  const email = (input.active || "").trim();
  const key = email.toLowerCase();
  if (!key) return { allowed: false, role: null, reason: "anonymous", email: "" };

  // BOTH sides must be non-empty: two blanks are equal, and reading that as the owner would
  // admit exactly the unidentified caller refused above.
  const ownerKey = (input.owner || "").trim().toLowerCase();
  if (ownerKey && ownerKey === key) return { allowed: true, role: "owner", reason: "owner", email };

  if (input.admins.indexOf(key) >= 0) return { allowed: true, role: "admin", reason: "admin", email };
  if (input.users.indexOf(key) >= 0) return { allowed: true, role: "viewer", reason: "listed", email };

  // An empty owner domain must never match an empty caller domain.
  if (input.mode === "org") {
    const d = domainOf(key);
    if (d && d === domainOf(ownerKey)) return { allowed: true, role: "viewer", reason: "org", email };
  }
  return { allowed: false, role: null, reason: "not-listed", email };
}

// A conservative ASCII address: local part of letters, digits and . _ % + - (no leading,
// trailing or doubled dot), then a dotted host of letters, digits and hyphens (no label starting
// or ending with a hyphen). Control, bidi, zero-width characters and markup cannot match.
const LOCAL_PART = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** True for an address validateAddresses accepts (after trim and lowercase). */
export function isPlainAddress(email: string): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  if (e.length > 254) return false;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return false;
  const local = e.slice(0, at);
  const host = e.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((l) => HOST_LABEL.test(l));
}

// An entry is echoed back in the refusal; anything outside printable ASCII is shown escaped so a
// bidi or zero-width character is visible, and the echo is capped.
function shown(e: string): string {
  const s = e.replace(/[^\x21-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

/** validateAddresses of undefined or null: a payload without its list is refused, never read as empty. */
export const ACCESS_LIST_MISSING_MESSAGE = "No list was sent. To remove everyone, save an empty list.";

/**
 * Parse and vet a submitted roster, or throw ApiError("error") saying why not. Accepts an
 * array or pasted text in any delimited shape. An entry that is not a plain ASCII
 * local@host.domain (isPlainAddress) is a typo, not a policy: keeping it silently would leave
 * someone convinced they had added a colleague. The returned list's JSON fits one Script
 * Property. undefined and null are refused (a misspelled field must not empty the list): a
 * caller that means "empty the list" passes [].
 */
export function validateAddresses(raw: unknown): string[] {
  if (raw === undefined || raw === null) throw new ApiError("error", ACCESS_LIST_MISSING_MESSAGE);
  const parts = Array.isArray(raw) ? raw.map((x) => (x === null || x === undefined ? "" : String(x))) : [String(raw ?? "")];
  const list = normalize(parts);
  const bad = list.filter((e) => !isPlainAddress(e));
  if (bad.length) throw new ApiError("error", "Not an email address: " + bad.slice(0, 10).map(shown).join(", "));
  if (list.length > ACCESS_MAX_ENTRIES) {
    throw new ApiError("error", "Too many people (" + list.length + "); the limit is " + ACCESS_MAX_ENTRIES + ".");
  }
  const bytes = utf8ByteLength(JSON.stringify(list));
  if (bytes > PROP_MAX_BYTES) {
    throw new ApiError("error", "That list is too long to store (" + bytes + " of " + PROP_MAX_BYTES + " bytes).");
  }
  return list;
}

/** The "ask for access" mailto, with the subject filled in so the request arrives legible. */
export function contactMailto(email: string, product: string): string {
  return "mailto:" + email.trim() + "?subject=" + encodeURIComponent("Access to " + product);
}

// ------------------------------------------------------------------ the bound object

export interface AccessOptions {
  /** The product name on the denied page and in the mailto subject. */
  product: string;
  props: AccessProps;
  /** The owner's address. Default: Session.getEffectiveUser().getEmail(). */
  ownerEmail?: () => string;
  /** The mode when ACCESS_MODE is unset. */
  modeDefault: AccessMode;
  /** Property names, when an app must not use the defaults. */
  keys?: Partial<AccessKeys>;
  /**
   * Runs a save while holding a lock. Default: a pass-through, because the script lock is not
   * re-entrant and an endpoint is expected to wrap the save in withScriptLock itself (taking it
   * again here would refuse the save as busy, or release the endpoint's lock early). Each save
   * replaces one whole property in a single write. With a `base` (see saveUsers), the stale-base
   * comparison, onChange and the write all run inside this lock, so the app must hold the script
   * lock around the save (or pass `lock: withScriptLock` when it does not) for the check to mean
   * anything.
   */
  lock?: <T>(fn: () => T) => T;
  /**
   * When true, an unset owner pin (keys.owner) denies every caller as "misconfigured", until
   * pinOwner runs from the editor. Default false: no pin keeps the unpinned behaviour.
   */
  requireOwnerPin?: boolean;
  /**
   * Default true. When false, mode() always reads "list", nobody is admitted by domain, and
   * saveMode("org") is refused as forbidden.
   */
  allowOrg?: boolean;
  /**
   * Called after a save is validated and before it is written, inside the lock. A throw
   * refuses the save (nothing is written): this is how an app makes its audit record mandatory.
   */
  onChange?: (e: AccessChange) => void;
  /**
   * Show the owner's address to a caller whose account could not be identified. Default false:
   * an anonymous caller may be anyone on the internet when the app is deployed to any Google
   * account, so the owner is named only to callers who were identified and refused.
   */
  contactAnonymous?: boolean;
  /**
   * Default false. When true, saveUsers, saveAdmins and saveMode called without an own `base`
   * in opts throw ApiError("conflict", ACCESS_BASE_REQUIRED_MESSAGE) and write nothing, so a
   * caller that never loaded the list (an old page, a client bug) cannot overwrite a revocation.
   */
  requireBase?: boolean;
}

/** The refusal of a save without a base under requireBase. */
export const ACCESS_BASE_REQUIRED_MESSAGE = "This page is out of date. Reload it, then save again.";

export interface AccessSaveOptions {
  /** The value the caller loaded (a list, or a mode). Omitted: no stale-base check, or a refusal under requireBase. */
  base?: unknown;
}

export interface Access {
  /**
   * The current caller's decision, memoized for the execution and for the current Script
   * Properties snapshot (withScriptLock drops it, so an in-lock check re-reads the lists).
   */
  decide(): AccessDecision;
  /** The caller's role, or null when denied. */
  role(): Role | null;
  /** The current mode. */
  mode(): AccessMode;
  /** Null when allowed; else a forbidden envelope (and one console line). */
  denyResult(op: string): DenyEnvelope | null;
  /** Null when allowed; else the page doGet serves instead of the app. */
  deniedPage(): GoogleAppsScript.HTML.HtmlOutput | null;
  /** Throws ApiError("forbidden") for a denied caller. For editor-run globals. */
  assertAllowed(op: string): void;
  /** Throws ApiError("forbidden") unless the caller is the owner. */
  assertOwner(op: string): void;
  isOwner(): boolean;
  /** Owner or admin: may edit the users list (and settings). */
  canEditUsers(): boolean;
  /** Owner only: admins may not promote admins, or the tier collapses into ownership. */
  canEditAdmins(): boolean;
  /** Owner only. */
  canEditMode(): boolean;
  /** Owner or admin. */
  canEditSettings(): boolean;
  currentUsers(): string[];
  currentAdmins(): string[];
  ownerEmail(): string;
  ownerDomain(): string;
  /** This deployment's URL, or null when it cannot be determined. */
  serviceUrl(): string | null;
  /** The account picker pointed back at this deployment, or null when the URL is unknown. */
  accountChooserUrl(): string | null;
  /**
   * Validate and store the users list (owner or admin). Returns the stored list. With
   * opts.base (the list the caller loaded), a stored list that differs from it as a set is a
   * stale save: ApiError("conflict"), nothing written.
   */
  saveUsers(raw: unknown, opts?: AccessSaveOptions): string[];
  /** Validate and store the admins list (owner only), with the same optional base check. */
  saveAdmins(raw: unknown, opts?: AccessSaveOptions): string[];
  /**
   * Store the mode (owner only); anything but "list" or "org" is refused, and "org" is
   * forbidden when allowOrg is false. With opts.base, a stored mode other than base conflicts.
   */
  saveMode(raw: unknown, opts?: AccessSaveOptions): AccessMode;
  /**
   * Pin the owner: store the effective user's address in keys.owner and return it. Call it only
   * from a private (trailing underscore) function run in the editor, never from a public
   * global. Refused (forbidden) unless the active user equals the effective
   * user and is not blank; refused (conflict) when a different address is already pinned,
   * unless force. Pinning the address already pinned is a no-op.
   */
  pinOwner(opts?: { force?: boolean }): string;
  /** True when an owner pin is stored. */
  ownerPinned(): boolean;
  /** Forget the memoized decision (tests, the dev server between requests, after a save). */
  resetMemo(): void;
}

const DENIAL_MESSAGE: Record<string, string> = {
  anonymous:
    "This app can't identify your Google account. It only recognizes accounts signed in to " +
    "the same Google Workspace domain as the app.",
  "not-listed": "Your account isn't on this app's access list.",
  misconfigured:
    "This app is not set up correctly, so it is closed for everyone. Whoever runs it needs to " +
    "check how it is deployed.",
};

const STALE_MESSAGE =
  "Someone else changed this list since you opened it. Reload to see their changes, then save again.";
const STALE_MODE_MESSAGE =
  "Someone else changed the access mode since you opened it. Reload, then save again.";
const ORG_OFF_MESSAGE = "This app does not allow whole-domain access.";

const OWNER_ONLY = "Only the owner can do that.";

function denialMessage(reason: AccessReason): string {
  return DENIAL_MESSAGE[reason] ?? DENIAL_MESSAGE["not-listed"]!;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const inB: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const x of b) inB[x] = true;
  return a.every((x) => inB[x] === true);
}

function minus(a: readonly string[], b: readonly string[]): string[] {
  const inB: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const x of b) inB[x] = true;
  return a.filter((x) => inB[x] !== true);
}

function baseList(base: unknown): string[] {
  if (Array.isArray(base)) return normalize(base.map((x) => (x === null || x === undefined ? "" : String(x))));
  if (typeof base === "string") return parseAddressList(base);
  return normalize([]);
}

export function createAccess(opts: AccessOptions): Access {
  const product = opts.product;
  const props = opts.props;
  const keys: AccessKeys = { ...ACCESS_PROP_KEYS, ...(opts.keys ?? {}) };
  const modeDefault: AccessMode = opts.modeDefault === "org" ? "org" : "list";
  const readOwner = opts.ownerEmail ?? (() => Session.getEffectiveUser().getEmail());
  const allowOrg = opts.allowOrg !== false;
  const requireOwnerPin = opts.requireOwnerPin === true;
  const requireBase = opts.requireBase === true;

  // One execution in GAS is one request by one caller, so the decision is memoized: doGet
  // and its include() scriptlets would otherwise each re-read the properties and Session.
  // The memo is keyed to the active email, so a long-lived process that serves several
  // identities (the dev server) never hands one identity's decision to the next, and to the
  // execution and Script Properties generations, so a check made once withScriptLock has
  // dropped the snapshot sees the lists as they are under the lock.
  let memo: AccessDecision | undefined;
  let memoActive: string | undefined;
  let memoPropsGen = -1;
  let memoExecGen = -1;
  const lock = opts.lock ?? (<T>(fn: () => T): T => fn());
  const contactAnonymous = opts.contactAnonymous === true;

  function ownerEmail(): string {
    try {
      return String(readOwner() || "").trim();
    } catch {
      return "";
    }
  }

  /** The account this execution runs as, lowercased; "" when it cannot be read. */
  function effectiveEmail(): string {
    try {
      return String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  function storedPin(): string {
    return String(props.get(keys.owner) ?? "").trim().toLowerCase();
  }

  /** True when the pin (or its absence under requireOwnerPin) closes the app to everyone. */
  function misconfigured(): boolean {
    const pin = storedPin();
    if (!pin) return requireOwnerPin;
    return effectiveEmail() !== pin;
  }

  function mode(): AccessMode {
    if (!allowOrg) return "list";
    return parseAccessMode(props.get(keys.mode), modeDefault);
  }

  function decide(): AccessDecision {
    const active = Session.getActiveUser().getEmail();
    const key = String(active ?? "").trim().toLowerCase();
    const pg = propsGeneration();
    const eg = executionGeneration();
    if (memo === undefined || memoActive !== key || memoPropsGen !== pg || memoExecGen !== eg) {
      memoActive = key;
      memoPropsGen = pg;
      memoExecGen = eg;
      memo = misconfigured()
        ? { allowed: false, role: null, reason: "misconfigured", email: String(active ?? "").trim() }
        : decideAccess({
            active,
            owner: ownerEmail(),
            users: parseAddressList(props.get(keys.users)),
            admins: parseAddressList(props.get(keys.admins)),
            mode: mode(),
          });
    }
    return memo;
  }

  // A denial is not a fault: one console line per refusal, and `reason` makes it readable in
  // aggregate. A reload loop from a revoked account must not fill the error log.
  function logDenial(op: string, d: AccessDecision): void {
    console.log(JSON.stringify({ access: "denied", op, reason: d.reason, email: d.email }));
  }

  /** Whom a denied caller is told to contact: nobody when misconfigured or (by default) anonymous. */
  function contactFor(d: AccessDecision): string {
    if (d.reason === "misconfigured") return "";
    if (d.reason === "anonymous" && !contactAnonymous) return "";
    return ownerEmail();
  }

  function denyResult(op: string): DenyEnvelope | null {
    const d = decide();
    if (d.allowed) return null;
    logDenial(op, d);
    const env: DenyEnvelope = { ok: false, error: denialMessage(d.reason), errorKind: "forbidden" };
    // Separate fields rather than part of `error`, so the client composes the sentence.
    const who = contactFor(d);
    if (who) {
      env.contact = who;
      env.contactUrl = contactMailto(who, product);
    }
    return env;
  }

  function serviceUrl(): string | null {
    try {
      return ScriptApp.getService().getUrl() || null;
    } catch {
      return null;
    }
  }

  function accountChooserUrl(): string | null {
    const url = serviceUrl();
    return url
      ? ["https:", "", "accounts.google.com", "AccountChooser"].join("/") + "?continue=" + encodeURIComponent(url)
      : null;
  }

  function deniedPage(): GoogleAppsScript.HTML.HtmlOutput | null {
    const d = decide();
    if (d.allowed) return null;
    logDenial("doGet", d);
    if (d.reason === "misconfigured") {
      // Nobody can fix this by switching account, and the owner is not named.
      return cardPage({
        title: product,
        eyebrow: product,
        heading: "This app is not available.",
        lines: [denialMessage("misconfigured")],
      });
    }
    const seen = d.email
      ? "You're signed in as " + d.email + "."
      : "This app can't see which Google account you're signed in as, which happens when the " +
        "account isn't in the same Google Workspace domain as the app.";
    // Naming the owner is deliberate for an identified caller, who could look the owner up
    // anyway; an anonymous one is not told unless contactAnonymous. No roster or property name.
    const who = contactFor(d);
    const ask = who
      ? "If you think you should have access, contact " + who + "."
      : "If you think you should have access, ask whoever runs this app to add you.";
    const switchUrl = accountChooserUrl();
    return cardPage({
      title: product,
      eyebrow: product,
      heading: "You don't have access to this app.",
      lines: [seen, ask],
      action: switchUrl ? { href: switchUrl, label: "Switch Google account" } : undefined,
    });
  }

  function assertAllowed(op: string): void {
    const d = decide();
    if (d.allowed) return;
    logDenial(op, d);
    throw new ApiError("forbidden", denialMessage(d.reason));
  }

  function isOwner(): boolean {
    return decide().reason === "owner";
  }

  function assertOwner(op: string): void {
    assertAllowed(op);
    if (isOwner()) return;
    logDenial(op, decide());
    throw new ApiError("forbidden", OWNER_ONLY);
  }

  function canEditUsers(): boolean {
    const r = decide().reason;
    return r === "owner" || r === "admin";
  }

  function requireSetter(): (key: string, value: string) => void {
    if (!props.set) throw new Error("createAccess: props.set is required to save.");
    const set = props.set.bind(props);
    return set;
  }

  /**
   * One guarded save, wholly inside the lock: the permission check (on a decision that cannot
   * predate the lock), the stale-base check, onChange, then the single write.
   */
  function guardedSave<T>(body: () => { key: string; value: string; result: T }): T {
    const set = requireSetter();
    const out = lock(() => {
      const w = body();
      set(w.key, w.value);
      return w.result;
    });
    memo = undefined;
    return out;
  }

  function notify(e: AccessChange): void {
    if (opts.onChange) opts.onChange(e);
  }

  function hasBase(o: AccessSaveOptions | undefined): boolean {
    return o !== undefined && o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, "base") && o.base !== undefined;
  }

  /** Under requireBase, a save without a base is refused (after the permission check). */
  function assertBase(o: AccessSaveOptions | undefined): void {
    if (requireBase && !hasBase(o)) throw new ApiError("conflict", ACCESS_BASE_REQUIRED_MESSAGE);
  }

  function saveList(kind: "users" | "admins", key: string, raw: unknown, o: AccessSaveOptions | undefined): string[] {
    const op = kind === "users" ? "saveUsers" : "saveAdmins";
    return guardedSave(() => {
      if (kind === "users") {
        assertAllowed(op);
        if (!canEditUsers()) {
          logDenial(op, decide());
          throw new ApiError("forbidden", "Only the owner or an admin can do that.");
        }
      } else {
        assertOwner(op);
      }
      assertBase(o);
      const list = validateAddresses(raw);
      const current = parseAddressList(props.get(key));
      if (hasBase(o) && !sameSet(baseList(o!.base), current)) throw new ApiError("conflict", STALE_MESSAGE);
      notify({ kind, actor: decide().email, added: minus(list, current), removed: minus(current, list) });
      return { key, value: JSON.stringify(list), result: list };
    });
  }

  function pinOwner(o?: { force?: boolean }): string {
    const active = (() => {
      try {
        return String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
      } catch {
        return "";
      }
    })();
    const effective = effectiveEmail();
    if (!active || !effective || active !== effective) {
      throw new ApiError("forbidden", "Pin the owner from the Apps Script editor, signed in as the deploying account.");
    }
    const set = requireSetter();
    const out = lock(() => {
      const pin = storedPin();
      if (pin === effective) return effective;
      if (pin && !(o && o.force === true)) {
        throw new ApiError("conflict", "A different owner is already pinned. Re-run with force to replace it.");
      }
      set(keys.owner, effective);
      return effective;
    });
    memo = undefined;
    return out;
  }

  return {
    decide,
    role: () => decide().role,
    mode,
    denyResult,
    deniedPage,
    assertAllowed,
    assertOwner,
    isOwner,
    canEditUsers,
    canEditAdmins: isOwner,
    canEditMode: isOwner,
    canEditSettings: canEditUsers,
    currentUsers: () => parseAddressList(props.get(keys.users)),
    currentAdmins: () => parseAddressList(props.get(keys.admins)),
    ownerEmail,
    ownerDomain: () => domainOf(ownerEmail()),
    serviceUrl,
    accountChooserUrl,
    saveUsers(raw: unknown, o?: AccessSaveOptions): string[] {
      return saveList("users", keys.users, raw, o);
    },
    saveAdmins(raw: unknown, o?: AccessSaveOptions): string[] {
      return saveList("admins", keys.admins, raw, o);
    },
    saveMode(raw: unknown, o?: AccessSaveOptions): AccessMode {
      return guardedSave(() => {
        assertOwner("saveMode");
        assertBase(o);
        if (raw !== "list" && raw !== "org") throw new ApiError("error", "The access mode must be list or org.");
        if (raw === "org" && !allowOrg) throw new ApiError("forbidden", ORG_OFF_MESSAGE);
        const current = mode();
        if (hasBase(o) && o!.base !== current) throw new ApiError("conflict", STALE_MODE_MESSAGE);
        notify({ kind: "mode", actor: decide().email, from: current, to: raw });
        return { key: keys.mode, value: raw, result: raw };
      });
    },
    pinOwner,
    ownerPinned: () => storedPin() !== "",
    resetMemo(): void {
      memo = undefined;
    },
  };
}
