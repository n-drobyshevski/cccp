// Flag parsing for the gas-kit CLI. No dependencies: each command declares the flags it takes.

export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * @typedef {object} FlagSpec
 * @property {number} [positional] how many positional arguments the command takes (default 0)
 * @property {string[]} [string] flags that take a value: --name value or --name=value
 * @property {string[]} [boolean] flags with no value: --yes
 * @property {string[]} [negatable] boolean flags that also accept --no-<name>
 */

/**
 * Parse the arguments after the command name.
 * @param {string[]} argv
 * @param {FlagSpec} spec
 * @returns {{ positional: string[], flags: Record<string, string | boolean> }}
 */
export function parseFlags(argv, spec) {
  const strings = new Set(spec.string ?? []);
  const booleans = new Set(spec.boolean ?? []);
  const negatable = new Set(spec.negatable ?? []);
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const raw = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    if (strings.has(raw)) {
      let value = inline;
      if (value === null) {
        value = argv[++i] ?? null;
        if (value === null || value.startsWith("--")) throw new UsageError("--" + raw + " needs a value");
      }
      flags[raw] = value;
    } else if (booleans.has(raw) || negatable.has(raw)) {
      if (inline !== null) throw new UsageError("--" + raw + " takes no value");
      flags[raw] = true;
    } else if (raw.startsWith("no-") && negatable.has(raw.slice(3))) {
      if (inline !== null) throw new UsageError("--" + raw + " takes no value");
      flags[raw.slice(3)] = false;
    } else {
      throw new UsageError("unknown flag --" + raw);
    }
  }
  const want = spec.positional ?? 0;
  if (positional.length > want) throw new UsageError("unexpected argument " + JSON.stringify(positional[want]));
  return { positional, flags };
}

/** @type {Record<string, FlagSpec>} */
export const COMMAND_SPECS = {
  create: {
    positional: 1,
    string: ["name", "product", "prefix", "accent", "access", "source", "tz", "kit-remote"],
    boolean: ["yes", "git", "force", "confidential"],
    negatable: ["e2e"],
  },
  "kit:verify": { string: ["root"], boolean: ["upstream"] },
  "kit:sync": { string: ["from", "ref", "remote", "root"], boolean: ["force"] },
  "kit:diff": { string: ["from", "ref", "root"], boolean: ["exit-code"] },
};
