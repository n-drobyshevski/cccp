// `doctor`: one row per setup check, the fix under each failure, and (on a terminal) an offer to run the fixes.
// Plain output goes through main's out(); the interactive session prints through ui.mjs, which sanitises.
import { spawn as nodeSpawn } from "node:child_process";
import { npmInvocation } from "./npm.mjs";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { UsageError } from "./args.mjs";
import { realContext, runChecks } from "./checks.mjs";
import { FriendlyError } from "./errors.mjs";
import { runLink } from "./link.mjs";
import { printable } from "./source.mjs";
import * as ui from "./ui.mjs";

/** The shape of --json, version 1: { version, ok, summary: { ok, warn, fail, info, needFixing }, checks: CheckResult[] }. */
export const JSON_VERSION = 1;

/**
 * The only commands doctor will ever run, matched exactly (never a prefix, never through a shell).
 * Anything else, whatever a check returns, is refused.
 */
export const FIX_ALLOW = [["npm", "install"], ["npx", "clasp", "login"], ["npx", "clasp", "login", "--no-localhost"]];

/** @param {string[]} command */
export function fixAllowed(command) {
  return FIX_ALLOW.some((a) => a.length === command.length && a.every((w, i) => w === command[i]));
}

/** @typedef {(cmd: string, args: string[], o: { cwd: string }) => Promise<number | null>} FixRunner */

/** Run a fix with the terminal attached, no shell. @type {FixRunner} */
function inheritSpawn(cmd, args, { cwd }) {
  return new Promise((done) => {
    try {
      const run = npmInvocation(cmd, args);
      const child = nodeSpawn(run.cmd, run.args, { cwd, stdio: "inherit", shell: false });
      child.on("error", () => done(null));
      child.on("close", (code) => done(code));
    } catch {
      done(null);
    }
  });
}

/** Run one fix from the allow list. Refuses anything else. @param {string[]} command @param {string} cwd @param {FixRunner} [spawn] */
export async function runFix(command, cwd, spawn = inheritSpawn) {
  if (!fixAllowed(command)) throw new Error("refusing to run a command that is not on the doctor allow list");
  return spawn(/** @type {string} */ (command[0]), command.slice(1), { cwd });
}

/** @param {import("./checks.mjs").CheckResult[]} results */
export function summarize(results) {
  const n = { ok: 0, warn: 0, fail: 0, info: 0, needFixing: 0 };
  for (const r of results) n[r.status]++;
  n.needFixing = n.fail + n.warn;
  return n;
}

/** The machine form. Titles and details are already one clean line each; no token or credential is ever in a result. @param {import("./checks.mjs").CheckResult[]} results */
export function toJson(results) {
  const summary = summarize(results);
  return JSON.stringify({ version: JSON_VERSION, ok: summary.fail === 0, summary, checks: results }, null, 2);
}

const MARK = { ok: "✔", warn: "!", fail: "✖", info: "↑" };

/**
 * The report rows as data: a row with a status carries its mark, the rest is text (already one clean line).
 * @param {import("./checks.mjs").CheckResult[]} results
 * @returns {Array<{ status?: "ok" | "warn" | "fail" | "info", mark?: string, text: string }>}
 */
export function reportRows(results) {
  const width = Math.min(34, Math.max(...results.map((r) => r.title.length), 0));
  /** @type {Array<{ status?: "ok" | "warn" | "fail" | "info", mark?: string, text: string }>} */
  const rows = [];
  for (const r of results) {
    rows.push({ status: r.status, mark: MARK[r.status], text: r.detail ? r.title.padEnd(width) + "  " + r.detail : r.title });
    if (r.fix && r.status !== "ok") rows.push({ text: "      Fix: " + r.fix.label });
  }
  const n = summarize(results);
  rows.push({ text: "" });
  rows.push({ text: n.needFixing ? "  " + n.needFixing + (n.needFixing === 1 ? " thing needs" : " things need") + " fixing." : "  Everything looks fine." });
  return rows;
}

/** The plain report lines (no colour). @param {import("./checks.mjs").CheckResult[]} results @returns {string[]} */
export function reportLines(results) {
  return reportRows(results).map((r) => (r.mark ? "  " + r.mark + " " : "") + r.text);
}

/**
 * @typedef {object} DoctorOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {{ plain?: boolean, noColor?: boolean }} [globals]
 * @property {any} [input] @property {any} [output]
 * @property {Partial<import("./checks.mjs").CheckContext>} [context] overrides for tests
 * @property {FixRunner} [spawn] runs a fix (tests)
 */

/**
 * @param {{ positional: string[], flags: Record<string, string | boolean> }} parsed
 * @param {DoctorOptions} [opts]
 * @returns {Promise<{ lines: string[], code: number }>} lines for main's out() (empty after an interactive session)
 */
export async function runDoctor(parsed, opts = {}) {
  const env = opts.env ?? process.env;
  const rootFlag = parsed.flags["root"];
  if (rootFlag === "") throw new UsageError("--root needs a folder", { title: "--root needs a folder", why: "The flag was given with nothing after it.", fix: "Write --root <your app's folder>, or leave it out to use this folder.", more: "npm run kit -- help" });
  const root = resolve(typeof rootFlag === "string" ? rootFlag : ".");
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new UsageError("--root " + JSON.stringify(printable(root)) + " is not a folder that exists; pass your app's folder", { title: "That folder does not exist", why: printable(root) + " is not a folder on this computer.", fix: "Pass your app's folder: --root <folder>, or open a terminal inside it.", more: "npm run kit -- help" });
  const check = () => runChecks(realContext({ root, env, offline: parsed.flags["offline"] === true, ...opts.context }));
  const uiOpts = { input: opts.input, output: opts.output, env, flags: { ...parsed.flags, plain: opts.globals?.plain === true, "no-color": opts.globals?.noColor === true } };
  const results = check();
  const code = (/** @type {typeof results} */ r) => (summarize(r).fail ? 1 : 0);

  if (parsed.flags["json"] === true) return { lines: [toJson(results)], code: code(results) };
  if (!ui.isInteractive(uiOpts)) return { lines: ["Checking your setup...", "", ...reportLines(results)], code: code(results) };

  ui.print(["", "  Checking your setup…", ""], uiOpts);
  ui.report(reportRows(results), uiOpts);
  const runnable = results.filter((r) => r.fix && r.fix.kind !== "manual" && r.status !== "ok");
  if (!runnable.length) return { lines: [], code: code(results) };

  const go = await ui.select({ ...uiOpts, message: "Fix them now?", choices: [{ value: true, label: "Yes, one at a time" }, { value: false, label: "No, just show me" }], initial: true });
  if (!go) return { lines: [], code: code(results) };
  let acted = 0;
  // A Cancel (Esc) inside link ends the whole fix loop: the fixes after it are not offered.
  for (const r of runnable) {
    const fix = /** @type {import("./checks.mjs").Fix} */ (r.fix);
    if (fix.kind === "link") {
      // In-process, never spawned: link asks its own questions and writes only .clasp.json.
      if (!(await ui.confirm({ ...uiOpts, message: "Connect to Apps Script now? (runs npm run kit -- link)", initial: true }))) continue;
      acted++;
      try {
        await runLink({ positional: [], flags: { root } }, { env, globals: opts.globals, input: opts.input, output: opts.output, context: opts.context, spawn: opts.spawn });
      } catch (e) {
        if (e instanceof ui.CancelError) throw e;
        const f = /** @type {any} */ (e);
        ui.print(f instanceof FriendlyError ? ["  ✖ " + printable(f.title), "    " + printable(f.why), "    " + printable(f.fix)] : ["  ✖ Could not link: " + printable(String(f?.message ?? f)) + ". Run it yourself: npm run kit -- link"], uiOpts);
      }
      continue;
    }
    if (!fixAllowed(fix.command)) {
      ui.print(["  ✖ Not running " + fix.label + ": it is not on the list of commands doctor may run."], uiOpts);
      continue;
    }
    if (!(await ui.confirm({ ...uiOpts, message: "Run " + fix.label + "?", initial: true }))) continue;
    acted++;
    const status = await runFix(fix.command, root, opts.spawn);
    ui.print([status === 0 ? "  ✔ " + fix.label + " finished" : "  ✖ " + fix.label + " did not finish. Run it yourself: " + fix.label], uiOpts);
  }
  // Nothing was run, so nothing changed: no second report and no second network check.
  if (!acted) return { lines: [], code: code(results) };
  ui.print(["", "  Checking again…", ""], uiOpts);
  const again = check();
  ui.report(reportRows(again), uiOpts);
  return { lines: [], code: code(again) };
}
