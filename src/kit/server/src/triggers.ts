// Extracted from the author's production Apps Script apps; adapted.
// The daily time-driven trigger: one reconcile that is safe to run on every setup.
//
// The trigger list belongs to the RUNNING account, so setup must run as the executeAs account.
// Create-before-delete is deliberate: a failed create leaves the old trigger in place. The
// signature is written last, so a failed create leaves it stale and the next run retries.

import { ApiError } from "./envelope";
import { getProp, setProp } from "./props";

export interface DailyTriggerSpec {
  /** Name of the global function the trigger calls (a delegator in the entry file). */
  handler: string;
  /** Hour of day, 0..23, in tz. */
  hour: number;
  /** IANA zone, pinned explicitly: atHour otherwise follows the script's own zone. */
  tz: string;
  /** The Script Property that stores the last installed signature. */
  sigProp: string;
  /** Text for the returned line. Default "Daily trigger". */
  label?: string;
}

/** The identity of a schedule: a changed zone or hour changes it. */
export function dailyTriggerSignature(tz: string, hour: number): string {
  return tz + "|" + hour;
}

/**
 * Not locked: two setup() runs racing can briefly leave two triggers; the next run collapses
 * them. Run setup from one place.
 *
 * Install the daily trigger, or leave it alone when it is already right. A no-op only when the
 * signature matches AND exactly one trigger for the handler exists. Otherwise it creates the new
 * trigger first, then deletes every old one (collapsing duplicates), then records the signature.
 */
export function reconcileDailyTrigger(spec: DailyTriggerSpec): string {
  const label = spec.label || "Daily trigger";
  if (!Number.isInteger(spec.hour) || spec.hour < 0 || spec.hour > 23) {
    throw new Error("The trigger hour must be a whole number from 0 to 23.");
  }
  if (typeof spec.tz !== "string" || spec.tz.trim() === "") throw new Error("The trigger time zone must be a non-empty IANA name.");
  const want = dailyTriggerSignature(spec.tz, spec.hour);
  const when = spec.hour + ":00 " + spec.tz;
  const existing = ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === spec.handler);
  if (existing.length === 1 && getProp(spec.sigProp) === want) {
    return label + ": already installed (" + when + ")";
  }
  try {
    ScriptApp.newTrigger(spec.handler).timeBased().everyDays(1).atHour(spec.hour).inTimezone(spec.tz).create();
  } catch (e) {
    // The new trigger is created before the old ones go, so a project at its 20-trigger quota
    // fails here; say so instead of surfacing the bare service error.
    const err = new Error(
      "Could not create the " + label.toLowerCase() + ": a script project allows at most 20 triggers. " +
      "Delete unused triggers (Apps Script editor, Triggers) and run setup again. Original error: " +
      (e instanceof Error ? e.message : String(e)),
    );
    (err as Error & { cause?: unknown }).cause = e;
    throw err;
  }
  for (const t of existing) ScriptApp.deleteTrigger(t);
  setProp(spec.sigProp, want);
  return label + ": installed (" + when + ")" + (existing.length ? " (replaced " + existing.length + ")" : "");
}

/**
 * May this execution run a scheduled job? An installable trigger has NO active user, so an empty
 * activeEmail is the trigger context and is allowed. Anyone identified must be the owner: this is
 * deliberately stricter than "any allowed user". Comparison ignores case and surrounding space.
 *
 * Caveat: under USER_DEPLOYING a web caller from another domain or a consumer account ALSO has an
 * empty active email, and trigger handlers are top-level globals that google.script.run can
 * reach, so such a caller passes this guard. Keep handlers cheap and idempotent. A handler that
 * is only ever run by a trigger can require the event object, but only as protection against
 * accidental calls: a google.script.run caller chooses its own arguments and can pass
 * { triggerUid: "x" }. To be sure, use assertTriggerRun (or isTriggerRun), which checks that the
 * uid names a real trigger of the project AND applies this rule, so neither half can be dropped.
 */
export function triggerAllowed(ctx: { activeEmail: string | null | undefined; ownerEmail: string | null | undefined }): boolean {
  const active = String(ctx.activeEmail ?? "").trim().toLowerCase();
  if (!active) return true;
  const owner = String(ctx.ownerEmail ?? "").trim().toLowerCase();
  return owner !== "" && active === owner;
}

export interface TriggerRunOptions {
  /**
   * The handler the trigger the uid names must call. Required: without a non-empty name the check
   * refuses, so the uid of another job's trigger can never pass.
   */
  handler: string;
  /** The owner's address. Default: Session.getEffectiveUser().getEmail(). */
  ownerEmail?: () => string | null | undefined;
  /**
   * The caller's address. Default: Session.getActiveUser().getEmail(). A getter that answers
   * anything but a string, null or undefined (a User object, say) refuses.
   */
  activeEmail?: () => string | null | undefined;
}

/** The sentence assertTriggerRun throws with. It says nothing about why. */
export const TRIGGER_REFUSED_MESSAGE = "Not permitted.";

/** The address a getter answers: "" for null or undefined, null (refuse) for a throw or a non-string. */
function read(fn: (() => string | null | undefined) | undefined, fallback: () => string): string | null {
  try {
    const v: unknown = fn ? fn() : fallback();
    if (v === null || v === undefined) return "";
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * True only for a real run of an installable trigger: the event's triggerUid names one of this
 * project's triggers whose handler is opts.handler, and triggerAllowed passes for the caller.
 * A google.script.run caller can pass any event object, so the uid lookup is what proves it; a
 * missing handler name, a failing lookup and a failing or non-string identity read refuse.
 */
export function isTriggerRun(e: unknown, opts: TriggerRunOptions): boolean {
  const handler = opts !== null && typeof opts === "object" ? (opts as { handler?: unknown }).handler : undefined;
  if (typeof handler !== "string" || handler.trim() === "") return false;
  const uid =
    e !== null && typeof e === "object" && typeof (e as { triggerUid?: unknown }).triggerUid === "string"
      ? (e as { triggerUid: string }).triggerUid
      : "";
  if (!uid) return false;
  try {
    const real = ScriptApp.getProjectTriggers().some(
      (t) => t.getUniqueId() === uid && t.getHandlerFunction() === handler,
    );
    if (!real) return false;
  } catch {
    return false;
  }
  const active = read(opts.activeEmail, () => Session.getActiveUser().getEmail());
  const owner = read(opts.ownerEmail, () => Session.getEffectiveUser().getEmail());
  if (active === null || owner === null) return false;
  return triggerAllowed({ activeEmail: active, ownerEmail: owner });
}

/**
 * Throws ApiError("forbidden", TRIGGER_REFUSED_MESSAGE) unless isTriggerRun(e, opts). Call it
 * first in every trigger handler:
 *
 *   export function refreshRegister(e?: { triggerUid?: string }) {
 *     assertTriggerRun(e, { handler: "trigger_refresh", ownerEmail: () => access.ownerEmail() });
 *     ...
 *   }
 */
export function assertTriggerRun(e: unknown, opts: TriggerRunOptions): void {
  if (!isTriggerRun(e, opts)) throw new ApiError("forbidden", TRIGGER_REFUSED_MESSAGE);
}
