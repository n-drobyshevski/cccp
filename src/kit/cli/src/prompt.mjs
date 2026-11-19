// Interactive prompts for missing `create` values, only on a TTY.

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Ask for each missing value one at a time, showing a default computed from the earlier answers and re-asking until the check passes.
 * A question whose skip(answers) is true is not asked.
 * @param {Array<{ key: string, label: string, def: (answers: Record<string, string>) => string, check: (v: string) => string | null, skip?: (answers: Record<string, string>) => boolean }>} questions
 * @returns {Promise<Record<string, string>>}
 */
export async function askAll(questions) {
  // Loaded here, not at the top: the module is newer than the oldest Node the version guard in bin.mjs must reach.
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  /** @type {Record<string, string>} */
  const out = {};
  try {
    for (const q of questions) {
      if (q.skip && q.skip(out)) continue;
      const def = q.def(out);
      for (;;) {
        const answer = (await rl.question(q.label + " [" + def + "]: ")).trim() || def;
        const why = q.check(answer);
        if (!why) {
          out[q.key] = answer;
          break;
        }
        console.log("  " + why);
      }
    }
  } finally {
    rl.close();
  }
  return out;
}
