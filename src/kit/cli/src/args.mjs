// Flag parsing for the gas-kit CLI. No dependencies: each command's flags come from its row in commands.mjs.
import { FriendlyError } from "./errors.mjs";
import { COMMANDS, flagsOf } from "./commands.mjs";

export class UsageError extends FriendlyError {
  /**
   * @param {string} message the technical text (also the Error message)
   * @param {{ title: string, why?: string | string[], fix?: string | string[], more?: string | string[] }} [friendly] plain-words form; without it the error prints as "error: <message>"
   */
  constructor(message, friendly) {
    super({ title: friendly?.title ?? "", ...(friendly ?? {}), detail: message });
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

/** One line safe to print: control characters shown as "?". @param {unknown} s */
function plain(s) {
  return String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
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
        if (value === null || value.startsWith("--")) throw new UsageError("--" + raw + " needs a value", { title: "--" + raw + " needs a value", why: "The flag was given with nothing after it.", fix: "Write it as --" + raw + " <value>.", more: "npm run kit -- help" });
      }
      flags[raw] = value;
    } else if (booleans.has(raw) || negatable.has(raw)) {
      if (inline !== null) throw new UsageError("--" + raw + " takes no value", { title: "--" + raw + " takes no value", why: "It is an on or off switch, not a setting.", fix: "Write just --" + raw + ".", more: "npm run kit -- help" });
      flags[raw] = true;
    } else if (raw.startsWith("no-") && negatable.has(raw.slice(3))) {
      if (inline !== null) throw new UsageError("--" + raw + " takes no value", { title: "--" + raw + " takes no value", why: "It is an on or off switch, not a setting.", fix: "Write just --" + raw + ".", more: "npm run kit -- help" });
      flags[raw.slice(3)] = false;
    } else {
      throw new UsageError("unknown flag --" + raw, { title: "gas-kit does not know the flag --" + raw, why: "It is not one of this command's flags.", fix: "Check the spelling, or see the flags of each command.", more: "npm run kit -- help" });
    }
  }
  const want = spec.positional ?? 0;
  if (positional.length > want) throw new UsageError("unexpected argument " + JSON.stringify(positional[want]), { title: "gas-kit does not understand the extra word " + JSON.stringify(plain(positional[want])), why: "This command takes " + (want === 0 ? "no words after its name, only flags" : "only " + want + " word after its name") + ".", fix: "Remove it, or check the spelling of the command.", more: "npm run kit -- help" });
  return { positional, flags };
}

/**
 * The parser's spec of a command, from its row in commands.mjs: a flag with a value hint takes a value,
 * a negatable one also takes --no-<name>, any other is an on or off switch.
 * @param {import("./commands.mjs").Command} cmd
 * @returns {FlagSpec}
 */
export function specOf(cmd) {
  const flags = flagsOf(cmd);
  /** @type {FlagSpec} */
  const spec = {};
  if (cmd.positionals.length) spec.positional = cmd.positionals.length;
  const string = flags.filter((f) => f.hint !== undefined).map((f) => f.name);
  const boolean = flags.filter((f) => f.hint === undefined && !f.negatable).map((f) => f.name);
  const negatable = flags.filter((f) => f.negatable).map((f) => f.name);
  if (string.length) spec.string = string;
  if (boolean.length) spec.boolean = boolean;
  if (negatable.length) spec.negatable = negatable;
  return spec;
}

/** Every command's spec, built from the table in commands.mjs. @type {Record<string, FlagSpec>} */
export const COMMAND_SPECS = Object.fromEntries(COMMANDS.map((c) => [c.name, specOf(c)]));
