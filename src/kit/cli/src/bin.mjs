#!/usr/bin/env node
// gas-kit CLI: create, kit:verify, kit:sync, kit:diff. No dependencies: it runs from a fresh clone of the
// kit with no npm install, and from src/kit/cli in an app.
//   node packages/cli/src/bin.mjs create <dir> [--yes] [--name ..] [--product ..] [--prefix ..]
//        [--accent #rrggbb] [--access list|org] [--confidential] [--source none|sheet] [--tz <IANA>]
//        [--e2e | --no-e2e] [--git] [--kit-remote <git URL> | none] [--force]
//   node packages/cli/src/bin.mjs kit:verify [--root <app dir>] [--upstream]
//   node packages/cli/src/bin.mjs kit:sync [--from <kit checkout | git URL#ref>] [--ref <branch | tag | commit>]
//        [--remote <git URL> | none] [--root <app dir>] [--force]
//   node packages/cli/src/bin.mjs kit:diff [--from <kit checkout | git URL#ref>] [--ref <branch | tag | commit>]
//        [--root <app dir>] [--exit-code]
// With no --from, kit:sync and kit:diff take the kit from GAS_KIT (a checkout or a git URL#ref), else
// from the git URL remembered in kit.lock.json (kit.remote).
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_SPECS, UsageError, parseFlags } from "./args.mjs";
import { runCreate } from "./create.mjs";
import { runDiff, runSync } from "./sync.mjs";
import { formatProblems, verifyApp, verifyUpstream } from "./verify.mjs";

const USAGE = [
  "usage: gas-kit <command>",
  "  create <dir> [--yes] [--name <slug>] [--product <name>] [--prefix <prefix.>] [--accent <#hex>]",
  "               [--access list|org] [--confidential] [--source none|sheet] [--tz <IANA>] [--e2e | --no-e2e]",
  "               [--git] [--kit-remote <git URL> | none] [--force]",
  "      --confidential: the app holds confidential data (dataClass confidential: list access only, the",
  "                      owner pin required, no data in the page, admin-only exports, an audit sheet).",
  "                      Without it the prompt asks (default no); --yes keeps internal",
  "      --kit-remote: the kit repository teammates fetch from, remembered in kit.lock.json",
  "                    (default: the origin of the kit clone this runs from, when others can reach it)",
  "  kit:verify [--root <app dir>] [--upstream]",
  "      --upstream: also fetch kit.remote at the full kit.commit and fail on any difference from src/kit",
  "                  or from the lock's hashes (run it in CI: the lock alone cannot vouch for itself)",
  "  kit:sync [--from <kit checkout | git URL#ref>] [--ref <branch | tag | commit>]",
  "           [--remote <git URL> | none] [--root <app dir>] [--force]",
  "  kit:diff [--from <kit checkout | git URL#ref>] [--ref <branch | tag | commit>] [--root <app dir>] [--exit-code]",
  "      --exit-code: exit 1 when anything differs (as git diff does)",
  "      the kit source, first that applies: --from; the GAS_KIT environment variable (a kit checkout or",
  "      a git URL#ref); the git URL remembered in kit.lock.json (its default branch, or --ref)",
  "      --remote: remember this git URL in kit.lock.json (none forgets it) and, with no --from or GAS_KIT,",
  "                sync from it; --from <git URL> remembers that URL too, a directory or GAS_KIT changes nothing",
  "      --ref: a branch, a tag, or a commit (7 to 64 hex digits, always a commit, never a branch name);",
  "             git URLs are fetched over https or ssh (a file: URL only as --from or GAS_KIT)",
];

/** The oldest Node major the kit runs on (the root package.json engines field says the same). */
export const MIN_NODE = 22;

/**
 * True when a Node version is older than the kit needs.
 * @param {string} version as in process.version ("v20.11.1") or process.versions.node ("20.11.1")
 */
export function nodeTooOld(version) {
  const major = Number.parseInt(String(version).replace(/^v/, ""), 10);
  return Number.isFinite(major) && major < MIN_NODE;
}

/** The one line printed when Node is too old. @param {string} version */
export function nodeTooOldMessage(version) {
  return "gas-kit needs Node " + MIN_NODE + " or newer (this is " + version + "). With nvm: nvm install " + MIN_NODE;
}

/** One line with every control character but the tab shown as "?". @param {string} line */
export function plainLine(line) {
  return String(line).replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, "?");
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ out?: (line: string) => void, err?: (line: string) => void, env?: Record<string, string | undefined>, nodeVersion?: string }} [io]
 *   env (default process.env) is where GAS_KIT is read; nodeVersion (default process.version) is what the version guard checks
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, io = {}) {
  const rawOut = io.out ?? ((l) => console.log(l));
  const rawErr = io.err ?? ((l) => console.error(l));
  // Every printed line is plain text: a control character (an escape sequence, a carriage return) from
  // a lock, a file name or a kit file in a diff would repaint the terminal, so it is shown as "?". A tab
  // stays, and a message of several lines (a git error) is printed line by line. Values from the lock
  // are cleaned where they are used too (printable, formatProblems), so they cannot start a line.
  const out = (/** @type {string} */ l) => String(l).split("\n").forEach((part) => rawOut(plainLine(part)));
  const err = (/** @type {string} */ l) => String(l).split("\n").forEach((part) => rawErr(plainLine(part)));
  const env = io.env ?? process.env;
  const nodeVersion = io.nodeVersion ?? process.version;
  if (nodeTooOld(nodeVersion)) {
    err(nodeTooOldMessage(nodeVersion));
    return 1;
  }
  const [command, ...rest] = argv;
  try {
    if (!command || command === "--help" || command === "-h" || command === "help") {
      for (const l of USAGE) out(l);
      return command ? 0 : 2;
    }
    const spec = COMMAND_SPECS[command];
    if (!spec) throw new UsageError("unknown command " + JSON.stringify(command));
    const parsed = parseFlags(rest, spec);
    if (command === "create") {
      for (const l of await runCreate(parsed)) out(l);
      return 0;
    }
    if (command === "kit:verify") {
      const root = resolve(typeof parsed.flags["root"] === "string" ? parsed.flags["root"] : ".");
      const upstream = parsed.flags["upstream"] === true;
      const { problems } = verifyApp(root);
      /** @type {ReturnType<typeof verifyUpstream> | null} */
      const up = upstream && !problems.length ? verifyUpstream(root) : null;
      const all = [...problems, ...(up ? up.problems : [])];
      if (all.length) {
        err("kit:verify failed: " + all.length + " problem" + (all.length === 1 ? "" : "s") + (upstream && problems.length ? " (the upstream check runs once these are fixed)" : ""));
        for (const l of formatProblems(all)) err(l);
        return 1;
      }
      out("kit:verify ok: src/kit matches kit.lock.json and imports stay inside the kit.");
      if (up) out("kit:verify --upstream ok: src/kit and kit.lock.json match " + up.remote + " at " + up.commit + ".");
      return 0;
    }
    if (command === "kit:diff") {
      // The diff is the output, also when --exit-code makes it exit 1.
      const res = runDiff(parsed, env);
      for (const l of res.lines) out(l);
      return res.code;
    }
    const res = runSync(parsed, env, out);
    for (const l of res.lines) (res.code ? err : out)(l);
    return res.code;
  } catch (e) {
    const error = /** @type {Error} */ (e);
    err("error: " + error.message);
    if (error instanceof UsageError) for (const l of USAGE) err(l);
    return error instanceof UsageError ? 2 : 1;
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
