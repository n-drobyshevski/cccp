#!/usr/bin/env node
// gas-kit CLI: help [<topic>], (no command on a terminal: the home menu), create, doctor, link, update, ui, kit:verify, kit:sync, kit:diff, and the migrate commands. No dependencies: it runs from a fresh clone of the
// kit with no npm install, and from src/kit/cli in an app.
//   node packages/cli/src/bin.mjs create [<dir>] [--yes] [--name ..] [--product ..] [--prefix ..]
//        [--accent #rrggbb] [--access list|org] [--confidential] [--source none|sheet] [--tz <IANA>]
//        [--e2e | --no-e2e] [--git] [--kit-remote <git URL> | none] [--force]
//   node packages/cli/src/bin.mjs kit:verify [--root <app dir>] [--upstream]
//   node packages/cli/src/bin.mjs kit:sync [--from <kit checkout | git URL#ref>] [--ref <branch | tag | commit>]
//        [--remote <git URL> | none] [--root <app dir>] [--force]
//   node packages/cli/src/bin.mjs kit:diff [--from <kit checkout | git URL#ref>] [--ref <branch | tag | commit>]
//        [--root <app dir>] [--exit-code]
//   node packages/cli/src/bin.mjs migrate:<doctor|init|inventory|plan|apply|done|status|serve> ...
//   node packages/cli/src/bin.mjs migrate <source> <target> --fidelity preserve|reskin [...]
// With no --from, kit:sync and kit:diff take the kit from GAS_KIT (a checkout or a git URL#ref), else
// from the git URL remembered in kit.lock.json (kit.remote). When the lock remembers no remote, a sync
// from a checkout directory (--from or GAS_KIT) adopts that checkout's origin, once (--remote none opts out).
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_SPECS, UsageError, parseFlags } from "./args.mjs";
import { FriendlyError, closestCommand, extractGlobals, formatError } from "./errors.mjs";
import { CancelError, isInteractive, print as uiPrint } from "./ui.mjs";
import { TOPICS, overview, topicLines } from "./help.mjs";
import { usageLines } from "./commands.mjs";
import { docsUrlOf } from "./docsUrl.mjs";
import { runMenu, whereAmI } from "./menu.mjs";
import { runUi } from "./panel.mjs";
import { runCreate } from "./create.mjs";
import { runDoctor } from "./doctor.mjs";
import { runLink } from "./link.mjs";
import { runMigrateCommand, runServe } from "./migrate/migrate.mjs";
import { termSafe } from "./migrate/steps/_common.mjs";
import { runDiff, runSync } from "./sync.mjs";
import { runUpdate } from "./update.mjs";
import { formatProblems, verifyApp, verifyError, verifyUpstream } from "./verify.mjs";

/** The usage text, rendered from the command table (commands.mjs) and the help topics. */
export const USAGE = usageLines(Object.keys(TOPICS));

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

/** The technical text for a too-old Node (the --verbose detail of the friendly error). @param {string} version */
export function nodeTooOldMessage(version) {
  return "gas-kit needs Node " + MIN_NODE + " or newer (this is " + version + "). With nvm: nvm install " + MIN_NODE;
}

/** One line with every control character but the tab, and every bidi override or isolate, shown as "?". @param {string} line */
export function plainLine(line) {
  return String(line).replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "?");
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ out?: (line: string) => void, err?: (line: string) => void, env?: Record<string, string | undefined>, cwd?: string, nodeVersion?: string, serveUntil?: Promise<unknown>, input?: any, output?: any, menu?: Partial<import("./menu.mjs").MenuOptions>, ui?: { open?: (url: string) => void, ready?: (p: any) => void, previewUrl?: (port: number, env: Record<string, string | undefined>) => string } }} [io]
 *   env (default process.env) is where GAS_KIT is read; cwd (default ".") is where "help" looks for an app's docs address; nodeVersion (default process.version) is what the version guard checks;
 *   serveUntil (default SIGINT or SIGTERM) is when migrate:serve stops;
 *   input, output (default the process TTY streams) and menu (checks, spawn, run overrides) are for the home menu and its tests
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, io = {}) {
  // Every printed line is plain text: a control character (an escape sequence, a carriage return, a
  // bidi override) from the source app of a migration, a lock, a file name or a kit file in a diff
  // would repaint the terminal, so termSafe turns it into a space. A tab stays, and a message of
  // several lines (a git error) is printed line by line. Values from the lock are cleaned where they
  // are used too (printable, formatProblems), so they cannot start a line.
  const toOut = io.out ?? ((l) => console.log(l));
  const toErr = io.err ?? ((l) => console.error(l));
  /** @param {string} l */
  const out = (l) => String(l).split("\n").forEach((part) => toOut(termSafe(part)));
  /** @param {string} l */
  const err = (l) => String(l).split("\n").forEach((part) => toErr(termSafe(part)));
  const env = io.env ?? process.env;
  const nodeVersion = io.nodeVersion ?? process.version;
  const { argv: args, globals } = extractGlobals(argv);
  /** Print an error the friendly way (FriendlyError) or as "error: <message>". @param {unknown} e */
  const report = (e) => {
    // CI logs keep the technical line (the same CI test as the interactive guard).
    const ci = Boolean(env["CI"]) && env["CI"] !== "0" && env["CI"] !== "false";
    for (const l of formatError(e, { verbose: globals.verbose || ci })) err(l);
  };
  if (nodeTooOld(nodeVersion)) {
    report(
      new FriendlyError({
        title: "This Node.js is too old for gas-kit",
        why: "gas-kit needs Node " + MIN_NODE + " or newer, and this is " + nodeVersion + ".",
        fix: "nvm install " + MIN_NODE + "   (or install Node " + MIN_NODE + " from nodejs.org)",
        detail: nodeTooOldMessage(nodeVersion),
      }),
    );
    return 1;
  }
  const [command, ...rest] = args;
  try {
    if (!command && isInteractive({ input: io.input, output: io.output, env, flags: {} })) {
      // The home menu draws through ui.mjs (sanitised), not through out().
      const common = { env, globals, input: io.input, output: io.output };
      const res = await runMenu({
        ...common,
        usage: [...overview(), ...USAGE],
        run: {
          create: async () => runCreate({ positional: [], flags: {} }, common),
          doctor: async (root) => runDoctor({ positional: [], flags: { root } }, common),
          link: async (root) => runLink({ positional: [], flags: { root } }, common),
          update: async (root) => runUpdate({ positional: [], flags: { root } }, common),
          // The panel prints as it runs (through ui.mjs, sanitised) and returns to the menu when it stops.
          panel: async (root) => runUi({ positional: [], flags: { root } }, { env, say: (ls) => uiPrint(ls, { ...common, flags: { plain: globals.plain === true, "no-color": globals.noColor === true } }) }),
        },
        ...io.menu,
      });
      return res.code;
    }
    if (command === "help" && rest.length > 1) {
      throw new UsageError("help takes one topic, got " + rest.length, { title: "Help takes one word at a time", why: "You gave " + rest.length + " words after help.", fix: "npm run kit -- help <topic>", more: "npm run kit -- help" });
    }
    if (command === "help" && rest[0]) {
      for (const l of topicLines(rest[0])) out(l);
      return 0;
    }
    if (!command || command === "--help" || command === "-h" || command === "help") {
      // In an app, "help" ends its overview with the validated docs address (none in the kit repository).
      const root = resolve(io.cwd ?? ".");
      if (command) for (const l of overview(whereAmI(root) === "app" ? docsUrlOf(root, env) : null)) out(l);
      for (const l of USAGE) out(l);
      return command ? 0 : 2;
    }
    const spec = COMMAND_SPECS[command];
    if (!spec) {
      const near = closestCommand(command, [...Object.keys(COMMAND_SPECS), "help"]);
      throw new UsageError("unknown command " + JSON.stringify(command) + (near ? ". Did you mean " + near + "?" : ""), {
        title: "Unknown command " + JSON.stringify(plainLine(command)),
        why: near ? "Did you mean " + near + "?" : "It is not one of the commands.",
        fix: near ? "npm run kit -- " + near : "npm run kit -- help   (lists every command)",
        more: "npm run kit -- help",
      });
    }
    const parsed = parseFlags(rest, spec);
    if (command === "create") {
      for (const l of await runCreate(parsed, { env, globals })) out(l);
      return 0;
    }
    if (command === "doctor") {
      const res = await runDoctor(parsed, { env, globals });
      for (const l of res.lines) out(l);
      return res.code;
    }
    if (command === "link") {
      const res = await runLink(parsed, { env, globals });
      for (const l of res.lines) out(l);
      return res.code;
    }
    if (command === "update") {
      const res = await runUpdate(parsed, { env, globals, say: (ls) => ls.forEach((l) => out(l)) });
      for (const l of res.lines) out(l);
      return res.code;
    }
    if (command === "ui") {
      const res = await runUi(parsed, { env, say: (ls) => ls.forEach((l) => out(l)), ...io.ui });
      return res.code;
    }
    if (command === "kit:verify") {
      const root = resolve(typeof parsed.flags["root"] === "string" ? parsed.flags["root"] : ".");
      const upstream = parsed.flags["upstream"] === true;
      const { problems } = verifyApp(root);
      /** @type {ReturnType<typeof verifyUpstream> | null} */
      const up = upstream && !problems.length ? verifyUpstream(root) : null;
      const all = [...problems, ...(up ? up.problems : [])];
      if (all.length) {
        report(verifyError(all, root));
        err("kit:verify failed: " + all.length + " problem" + (all.length === 1 ? "" : "s") + (upstream && problems.length ? " (the upstream check runs once these are fixed)" : ""));
        for (const l of formatProblems(all)) err(l);
        return 1;
      }
      out("kit:verify ok: src/kit matches kit.lock.json and imports stay inside the kit.");
      if (up) out("kit:verify --upstream ok: src/kit and kit.lock.json match " + up.remote + " at " + up.commit + ".");
      return 0;
    }
    if (command === "migrate:serve") {
      const server = await runServe(parsed);
      for (const l of server.lines) out(l);
      await (io.serveUntil ?? untilSignal());
      await server.close();
      return 0;
    }
    if (command === "migrate" || command.startsWith("migrate:")) {
      const res = await runMigrateCommand(command, parsed);
      for (const l of res.lines) (res.code === 1 ? err : out)(l);
      return res.code;
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
    if (error instanceof CancelError) {
      err("Cancelled. Nothing was changed.");
      return 130;
    }
    report(error);
    if (error instanceof UsageError) {
      // A friendly usage error is three short lines (and where to read more); the whole usage text is for an
      // error with no friendly form, and for --verbose.
      const friendly = error instanceof FriendlyError && Boolean(error.title);
      if (!friendly || globals.verbose) for (const l of USAGE) err(l);
      else if (!error.more) err("  More  npm run kit -- help");
    }
    return error instanceof FriendlyError ? error.exitCode : 1;
  }
}

/** Resolves on the first SIGINT or SIGTERM. */
function untilSignal() {
  return new Promise((done) => {
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
