// Extracted from the author's production Apps Script apps; adapted.
// Long server jobs. createJobPoller is a DOM-free model: it starts a job, polls it with growing
// delays through an injected call(name, arg) function, and ends in done, error or cancelled.
// jobProgress is the matching view: a progress bar (or an indeterminate one), a status line and
// a cancel button, wired by the app with delegate on data-act="jobProgress:cancel".
import { html } from "@gas-kit/client/html.js";

/** Poll delays: the first wait, the growth per poll, the longest wait, in milliseconds. */
export const POLL_START_MS = 1000;
export const POLL_FACTOR = 1.6;
export const POLL_MAX_MS = 15000;
/** A job that runs longer than this is given up on. */
export const MAX_DURATION_MS = 10 * 60 * 1000;
/** Consecutive failed polls before the poller gives up. */
export const MAX_FAILURES = 5;

/**
 * The default for the `isTransient` option: a failed call is worth retrying unless it is a
 * permanent rpc error (kind "forbidden", or kind "error" whose message starts "Unknown endpoint").
 * @param {any} err
 * @returns {boolean}
 * @internal
 */
export function isTransientDefault(err) {
  if (!err || typeof err !== "object") return true;
  if (err.kind === "forbidden") return false;
  return !(err.kind === "error" && /^Unknown endpoint/.test(String(err.message || "")));
}

/** Server phases (any case) that map to a poller status. */
const TERMINAL = { done: "done", complete: "done", completed: "done", failed: "error", error: "error", cancelled: "cancelled", canceled: "cancelled" };

/**
 * The normalised terminal status of a job summary, or null while it is still running.
 * A job is `{state}` or `{phase}`; a missing job (null) is not terminal here.
 * @param {any} job
 * @returns {"done"|"error"|"cancelled"|null}
 * @internal
 */
export function terminalStatus(job) {
  if (!job) return null;
  const s = String(job.state || job.phase || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(TERMINAL, s) ? /** @type {any} */ (TERMINAL)[s] : null;
}

/**
 * The one predicate the poll loop uses: keep polling while the job exists and is not finished.
 * @param {any} job
 * @returns {boolean}
 * @internal
 */
export function shouldContinuePolling(job) {
  return !!job && terminalStatus(job) === null;
}

/**
 * @typedef {{status: "idle"|"starting"|"running"|"done"|"error"|"cancelled", jobId: string|null, progress: number|null, message: string, result: any, error: string, polls: number, elapsedMs: number}} JobState
 */

/**
 * The poller. `call(name, arg)` returns a promise of the server's answer. Starting calls
 * `startName` with the start argument; the answer is a job summary `{id, state|phase, progress?,
 * message?, result?, error?}`. Each poll calls `pollName` with the job id; a null answer means
 * the job is gone and ends as error. `cancelName`, if given, is called with the job id on cancel,
 * when the poller gives up on a timeout or an unreachable server, and (once its id is known)
 * when cancel was pressed before the start answer arrived; its failure is ignored and it is
 * never called with a null id. Only one request is in flight; the next poll is scheduled after the
 * answer. A failed poll whose error `isTransient(err)` says is permanent (default: kind
 * "forbidden" or "Unknown endpoint") ends at once as error with the error's message; a failed
 * start always ends as error with the message appended. The delay grows by `factor` per poll up to `maxMs` and restarts whenever progress
 * moves. A failed poll is transient until `maxFailures` in a row. Past `maxDurationMs` the job
 * ends as error with "timed out", from a deadline timer armed at start, so it also ends when a
 * start or poll call never settles. A terminal answer is delivered to `onUpdate` once, and a
 * throwing `onUpdate` is logged without ending the poll.
 * @param {{call: (name: string, arg?: any) => Promise<any>, startName: string, pollName: string, cancelName?: string, onUpdate?: (s: JobState) => void, startMs?: number, factor?: number, maxMs?: number, maxDurationMs?: number, maxFailures?: number, isTransient?: (err: any) => boolean, timers?: {setTimeout: (f: any, ms: number) => any, clearTimeout: (t: any) => void}, now?: () => number}} o
 * @returns {{start: (arg?: any) => Promise<void>, cancel: () => void, getState: () => JobState, isRunning: () => boolean}}
 * @internal
 */
export function createJobPoller(o) {
  const startMs = o.startMs ?? POLL_START_MS;
  const factor = o.factor ?? POLL_FACTOR;
  const maxMs = o.maxMs ?? POLL_MAX_MS;
  const maxDuration = o.maxDurationMs ?? MAX_DURATION_MS;
  const maxFailures = o.maxFailures ?? MAX_FAILURES;
  const isTransient = o.isTransient || isTransientDefault;
  const timers = o.timers || { setTimeout: (/** @type {any} */ f, /** @type {number} */ ms) => setTimeout(f, ms), clearTimeout: (/** @type {any} */ t) => clearTimeout(t) };
  const now = o.now || Date.now;
  /** @type {JobState} */
  let st = { status: "idle", jobId: null, progress: null, message: "", result: null, error: "", polls: 0, elapsedMs: 0 };
  let gen = 0;
  /** @type {any} */
  let timer = null;
  /** @type {any} */
  let deadline = null;
  let t0 = /** @type {number|null} */ (null);
  let delay = startMs;
  let failures = 0;
  // The start generation of a job cancelled before its start answer came back.
  const cancelledWhileStarting = new Set();

  const live = () => st.status === "starting" || st.status === "running";
  function emit() {
    st = { ...st, elapsedMs: t0 != null ? now() - t0 : 0 };
    if (!o.onUpdate) return;
    try { o.onUpdate({ ...st }); } catch (e) { console.error("[jobPoller] onUpdate failed:", e); }
  }
  function clear() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  function clearDeadline() {
    if (deadline !== null) timers.clearTimeout(deadline);
    deadline = null;
  }
  /** @param {any} job */
  function absorb(job) {
    // An answer without a progress figure keeps the last known one rather than going indeterminate.
    const known = job.progress != null && Number.isFinite(Number(job.progress));
    const p = known ? Math.min(1, Math.max(0, Number(job.progress))) : st.progress;
    if (known && p !== st.progress) delay = startMs;
    st = { ...st, jobId: job.id != null ? String(job.id) : st.jobId, progress: p, message: job.message != null ? String(job.message) : st.message, result: job.result !== undefined ? job.result : st.result };
    const end = terminalStatus(job);
    if (end) {
      clear();
      clearDeadline();
      st = { ...st, status: end, error: end === "error" ? String(job.error || job.message || "The job failed") : "", progress: end === "done" ? 1 : st.progress };
    } else st = { ...st, status: "running" };
  }
  /** Best effort: tell the server to stop a job this poller has given up on. @param {string|null} id */
  function cancelRemote(id) {
    if (!o.cancelName || id == null) return;
    try { Promise.resolve(o.call(o.cancelName, id)).catch(() => {}); } catch (e) { /* ignored: the job is over locally either way */ }
  }
  /** @param {string} reason @param {boolean} [stopRemote] also cancel the server job */
  function fail(reason, stopRemote) {
    clear();
    clearDeadline();
    const id = st.jobId;
    // Given up on before the start answer: stop the server job once its id arrives.
    if (stopRemote && id == null && st.status === "starting") cancelledWhileStarting.add(gen);
    gen += 1;
    st = { ...st, status: "error", error: reason };
    emit();
    if (stopRemote) cancelRemote(id);
  }
  function schedule() {
    clear();
    if (!live()) return;
    const g = gen;
    const wait = delay;
    delay = Math.min(maxMs, Math.round(delay * factor));
    const fn = () => { timer = null; if (g === gen) void poll(g); };
    timer = timers.setTimeout(fn, wait);
  }
  /** @param {number} g */
  async function poll(g) {
    if (now() - /** @type {number} */ (t0) > maxDuration) { fail("The job timed out", true); return; }
    /** @type {any} */
    let job;
    let ok = false;
    /** @type {any} */
    let err = null;
    try { job = await o.call(o.pollName, st.jobId); ok = true; } catch (e) { failures += 1; err = e; }
    if (g !== gen) return;
    st = { ...st, polls: st.polls + 1 };
    if (ok) {
      failures = 0;
      if (!job) { fail("The job is no longer available"); return; }
      absorb(job);
      emit();
      if (live()) schedule();
      return;
    }
    let transient = true;
    try { transient = isTransient(err) !== false; } catch (e) { /* a throwing hook counts as transient */ }
    if (!transient) { fail(errText(err, "The server refused the request"), true); return; }
    if (failures >= maxFailures) { fail("Could not reach the server", true); return; }
    schedule();
  }
  /** @param {any} e @param {string} dflt */
  function errText(e, dflt) {
    const m = e && typeof e === "object" && e.message != null ? String(e.message) : "";
    return m || dflt;
  }
  /** @param {any} [arg] */
  async function start(arg) {
    // Starting again while a job is live stops the previous server job.
    if (live()) {
      cancelRemote(st.jobId);
      // Still starting: stop that job once its id arrives.
      if (st.jobId == null) cancelledWhileStarting.add(gen);
    }
    clear();
    clearDeadline();
    gen += 1;
    const g = gen;
    t0 = now();
    // One deadline per job, so a start or poll call that never settles still ends the job.
    deadline = timers.setTimeout(() => { deadline = null; if (g === gen && live()) fail("The job timed out", true); }, maxDuration);
    delay = startMs;
    failures = 0;
    st = { status: "starting", jobId: null, progress: null, message: "", result: null, error: "", polls: 0, elapsedMs: 0 };
    emit();
    /** @type {any} */
    let job;
    try { job = await o.call(o.startName, arg); } catch (e) {
      if (g === gen) { const m = errText(e, ""); fail(m ? "Could not start the job: " + m : "Could not start the job"); }
      return;
    }
    if (g !== gen) {
      // Cancelled while the start call was in flight: now the id is known, stop the job on the server.
      if (cancelledWhileStarting.has(g) && job && job.id != null) cancelRemote(String(job.id));
      return;
    }
    if (!job) { fail("The job did not start"); return; }
    if (job.id == null && !terminalStatus(job)) { fail("The job did not start"); return; }
    absorb(job);
    emit();
    if (live()) schedule();
  }
  function cancel() {
    if (!live()) return;
    clear();
    clearDeadline();
    const id = st.jobId;
    if (id == null) cancelledWhileStarting.add(gen);
    gen += 1;
    st = { ...st, status: "cancelled" };
    emit();
    cancelRemote(id);
  }
  return { start, cancel, getState: () => ({ ...st }), isRunning: live };
}

const WORDS = { idle: "Not started", starting: "Starting", running: "Running", done: "Done", error: "Failed", cancelled: "Cancelled" };

/**
 * @component jobProgress
 * @title Job Progress
 * @category Feedback
 * @summary A progress bar for a long job with a status word, a message and a cancel button.
 * @param {{id?: string, status?: "idle"|"starting"|"running"|"done"|"error"|"cancelled", progress?: number|null, label?: string, message?: string, error?: string, cancelable?: boolean}} p
 * `progress` is 0 to 1; null or missing while running is indeterminate. `id` namespaces data-k (default "job"). The cancel button shows only while starting or running and only if `cancelable`; an error shows `error` and a retry button.
 * @emits jobProgress:cancel (data-id; the cancel button)
 * @emits jobProgress:retry (data-id; the retry button after an error)
 * @states running, indeterminate, done, error, cancelled
 * @a11y Motion: the determinate fill eases its width over --dur-4 and the indeterminate slide is a slow loop; under reduced motion both stop (the indeterminate bar becomes a static half-opacity bar). The bar is role=progressbar with aria-valuemin, aria-valuemax and an aria-valuenow only when the value is known (indeterminate omits it); it is named by `label`. Only the status word ("Running", "Done", "Failed") is a polite live region, so the percentage and message do not chatter on every poll and a change of state is announced once; an error message is role=alert. The app keeps the view's container stable (a re-render replaces nodes, which announces less reliably) and a failure is a word, not just a colour. Cancel and Retry disappear on the next render, so the app should move focus to the status word (tabindex=-1, data-k jobProgress-<id>-word) after handling either act; it is recreated on every render, so live announcements are best effort. The buttons have a data-k so focus survives a re-render. A failed or cancelled job with no progress figure keeps a progressbar without aria-valuenow, which reads as indeterminate.
 * @example running: jobProgress({ status: "running", progress: 0.4, label: "Syncing data", message: "400 of 1,000 rows", cancelable: true })
 * @example indeterminate: jobProgress({ status: "starting", label: "Syncing data", cancelable: true })
 * @example done: jobProgress({ status: "done", progress: 1, label: "Syncing data", message: "1,000 rows" })
 * @example error: jobProgress({ status: "error", label: "Syncing data", error: "The server timed out" })
 * @example cancelled: jobProgress({ status: "cancelled", progress: 0.4, label: "Syncing data" })
 */
export function jobProgress(p) {
  const q = p || {};
  const status = typeof q.status === "string" && Object.prototype.hasOwnProperty.call(WORDS, q.status) ? q.status : "idle";
  const id = q.id || "job";
  const known = q.progress != null && Number.isFinite(Number(q.progress));
  const frac = known ? Math.min(1, Math.max(0, Number(q.progress))) : status === "done" ? 1 : null;
  const pct = frac == null ? null : Math.round(frac * 100);
  const busy = status === "starting" || status === "running";
  const word = /** @type {any} */ (WORDS)[status];
  const text = status === "error" ? q.error || q.message || "" : q.message || "";
  return html`<div class="gk-jobProgress is-${status}${frac == null && busy ? " is-indeterminate" : ""}">
<div class="gk-jobProgress__bar" role="progressbar" aria-label="${q.label || "Job progress"}" aria-valuemin="0" aria-valuemax="100"${pct != null ? html` aria-valuenow="${pct}" aria-valuetext="${pct}%"` : ""}><i class="gk-jobProgress__fill" style="--gk-pct:${pct == null ? 0 : pct}"></i></div>
<div class="gk-jobProgress__row"><span class="gk-jobProgress__status"><span class="gk-jobProgress__word" role="status" aria-live="polite" tabindex="-1" data-k="jobProgress-${id}-word">${word}</span>${pct != null && busy ? html`<span class="gk-jobProgress__pct num">${pct}%</span>` : ""}${text ? html`<span class="gk-jobProgress__msg"${status === "error" ? html` role="alert"` : ""}>${text}</span>` : ""}</span>${busy && q.cancelable ? html`<button type="button" class="gk-jobProgress__btn gk-btn" data-variant="outline" data-size="sm" data-act="jobProgress:cancel" data-id="${id}" data-k="jobProgress-${id}-cancel">Cancel</button>` : ""}${status === "error" ? html`<button type="button" class="gk-jobProgress__btn gk-btn" data-variant="outline" data-size="sm" data-act="jobProgress:retry" data-id="${id}" data-k="jobProgress-${id}-retry">Retry</button>` : ""}</div>
</div>`;
}
