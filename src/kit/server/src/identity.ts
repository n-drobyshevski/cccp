// The Session identity, read once per execution. This is the only kit module that calls
// Session.getActiveUser or Session.getEffectiveUser: the noDangerousServerApis session rule
// allows it by default, and no other kit module. index.ts does not re-export it, so an app cannot
// read identity around that rule through the kit: access.ts, setup.ts and triggers.ts import it,
// and an app asks access.decide() and access.ownerEmail().
//
// Each Session read costs tens of milliseconds in Apps Script, and one RPC asks who the caller
// is several times (the deny check, the role, requireRole, the app's own fence, the audit actor
// and role). The caller and the account the script runs as cannot change inside one execution,
// so each is read once and kept until the next execution (beginExecution) or a new Session
// global (a fresh fake). A read that throws, or answers anything but a string, null or
// undefined, is kept as unknown (null) for the execution: the access decision denies it on every
// call, and isTriggerRun refuses it. A host that serves several callers in one process must start
// an execution per request (the entry points do); access.resetMemo() drops these too.

import { executionGeneration } from "./execution";

interface IdentityMemo {
  gen: number;
  session: unknown;
  value: string | null;
}

let activeMemo: IdentityMemo | null = null;
let effectiveMemo: IdentityMemo | null = null;

function sessionGlobal(): unknown {
  return typeof Session === "undefined" ? undefined : Session;
}

function readIdentity(get: () => unknown): string | null {
  try {
    const v = get();
    if (v === null || v === undefined) return "";
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function memoIdentity(memo: IdentityMemo | null, get: () => unknown): IdentityMemo {
  const gen = executionGeneration();
  const session = sessionGlobal();
  if (memo !== null && memo.gen === gen && memo.session === session) return memo;
  return { gen, session, value: readIdentity(get) };
}

/**
 * Session.getActiveUser().getEmail() as read once in this execution (untrimmed), "" for a blank
 * caller, null when the read failed.
 */
export function executionActiveEmail(): string | null {
  activeMemo = memoIdentity(activeMemo, () => Session.getActiveUser().getEmail());
  return activeMemo.value;
}

/**
 * Session.getEffectiveUser().getEmail() as read once in this execution (untrimmed), "" when
 * blank, null when the read failed.
 */
export function executionEffectiveEmail(): string | null {
  effectiveMemo = memoIdentity(effectiveMemo, () => Session.getEffectiveUser().getEmail());
  return effectiveMemo.value;
}

/** Forget both identity reads: the next one asks Session again. */
export function resetIdentityMemo(): void {
  activeMemo = null;
  effectiveMemo = null;
}
