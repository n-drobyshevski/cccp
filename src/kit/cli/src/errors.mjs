// Friendly errors for the gas-kit CLI: what happened, why, how to fix it. Internal module (no dependencies).
// The technical text of the old message is kept as `detail` and as the Error message, and is printed with --verbose.

/**
 * @typedef {object} FriendlyFields
 * @property {string} title one line: what could not be done
 * @property {string | string[]} [why] the reason, in plain words
 * @property {string | string[]} [fix] what to do next (a command, say)
 * @property {string | string[]} [more] where to read on, or extra lines (a list of problems)
 * @property {string} [detail] the technical text; also the Error message; printed only with --verbose
 * @property {number} [exitCode] default 1
 */

export class FriendlyError extends Error {
  /** @param {FriendlyFields} fields */
  constructor(fields) {
    super(fields.detail || fields.title);
    this.name = "FriendlyError";
    this.title = fields.title;
    this.why = fields.why ?? "";
    this.fix = fields.fix ?? "";
    this.more = fields.more ?? "";
    this.detail = fields.detail ?? "";
    this.exitCode = fields.exitCode ?? 1;
  }
}

/** @param {unknown} v @returns {string[]} */
function asLines(v) {
  return (Array.isArray(v) ? v : [v]).flatMap((s) => String(s ?? "").split("\n")).filter((s, i, a) => s !== "" || a.length > 1);
}

/**
 * The lines to print for an error. A FriendlyError with a title gives the three-line form; any other
 * error keeps today's "error: <message>". The caller prints each line through its plain-text filter.
 * @param {unknown} error
 * @param {{ verbose?: boolean }} [opts]
 * @returns {string[]}
 */
export function formatError(error, opts = {}) {
  const e = /** @type {any} */ (error);
  if (!(error instanceof FriendlyError) || !error.title) return ["error: " + String(e?.message ?? e)];
  /** @type {string[]} */
  const lines = ["✖ " + error.title];
  /** @type {Array<[string, unknown]>} */
  const rows = [["Why", error.why], ["Fix", error.fix], ["More", error.more]];
  for (const [label, value] of rows) {
    const parts = asLines(value).filter((s) => s !== "");
    parts.forEach((s, i) => lines.push(i === 0 ? "  " + label.padEnd(6) + s : "        " + s));
  }
  if (error.detail) {
    if (opts.verbose) {
      lines.push("  Detail");
      for (const s of asLines(error.detail)) lines.push("    " + s);
    } else {
      lines.push("  (run again with --verbose for the technical detail)");
    }
  }
  return lines;
}

/**
 * The argument list with the global flags taken out, and what they said.
 * @param {string[]} argv
 * @returns {{ argv: string[], globals: { verbose: boolean, plain: boolean, noColor: boolean } }}
 */
export function extractGlobals(argv) {
  const globals = { verbose: false, plain: false, noColor: false };
  const rest = argv.filter((a) => {
    if (a === "--verbose") globals.verbose = true;
    else if (a === "--plain") globals.plain = true;
    else if (a === "--no-color") globals.noColor = true;
    else return true;
    return false;
  });
  return { argv: rest, globals };
}

/** Edit distance (Levenshtein). @param {string} a @param {string} b */
export function editDistance(a, b) {
  /** @type {number[]} */
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(/** @type {number} */ (prev[j]) + 1, /** @type {number} */ (cur[j - 1]) + 1, /** @type {number} */ (prev[j - 1]) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return /** @type {number} */ (prev[b.length]);
}

/**
 * The closest command to a mistyped one, or null when nothing is near.
 * @param {string} word
 * @param {string[]} commands
 */
export function closestCommand(word, commands) {
  const w = word.toLowerCase();
  const tail = commands.find((c) => c.endsWith(":" + w));
  if (tail) return tail;
  let best = null;
  let bestD = Infinity;
  for (const c of commands) {
    const d = editDistance(w, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(best.length / 3)) ? best : null;
}
