// Extracted from the author's production Apps Script apps; adapted.
// The execution boundary. Apps Script starts every execution (one RPC, one doGet, one trigger)
// with fresh globals, so a per-execution memo (the Script Properties snapshot, each cache's
// memory) can never outlive it. Tests and long single-process hosts run many "executions" in one
// process, so the boundary is explicit too: beginExecution() bumps a generation and every memo
// taken under an older generation is dropped on its next use. The app's entry points (doGet,
// timedApi_, triggers) call it first; run() starts one only when none is open, and closes the
// one it is in when it returns, so an RPC through the entry reads the stores once and a direct
// api call (tests) still starts fresh.

let generation = 0;
let open = false;

/** Start a new execution: every per-execution memo is re-read on its next use. */
export function beginExecution(): void {
  generation++;
  open = true;
}

/** Start an execution unless one is open (an entry point began it). */
export function ensureExecution(): void {
  if (!open) beginExecution();
}

/** Close the current execution: the next ensureExecution() starts a new one. */
export function endExecution(): void {
  open = false;
}

/** The current execution generation, for memos to compare against. */
export function executionGeneration(): number {
  return generation;
}
