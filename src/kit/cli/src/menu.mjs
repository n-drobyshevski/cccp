// The home menu: `npm run kit` with no command on a terminal. It shows where you are (a status line from the
// fast doctor checks), lists the jobs people come to do with the command each one runs, runs the chosen one
// and returns to the menu. Everything it prints goes through ui.mjs (sanitised); the commands it spawns are a
// fixed table (npm run <script>, no shell), never text from a file. In-process commands (link, update, doctor,
// create) are injected so tests run the menu with no network, no child and no Google.
import { spawn as nodeSpawn } from "node:child_process";
import { npmInvocation } from "./npm.mjs";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NETWORK_TIMEOUT_MS, realContext, runChecks, runCommand } from "./checks.mjs";
import { docsUrlOf } from "./docsUrl.mjs";
import { formatError } from "./errors.mjs";
import { LOCK_FILE, parseLock } from "./hash.mjs";
import { printable } from "./source.mjs";
import * as ui from "./ui.mjs";

/** The longest the status line waits for the network, so the menu always opens within about two seconds. */
export const MENU_TIMEOUT_MS = 2000;

/** The npm scripts the menu may spawn, matched by name (never a value read from a file). */
export const SCRIPTS = { preview: "dev", push: "push", check: "check" };

/** Guide files shown by "Guides and help", each only when it exists in the app. */
const GUIDES = [
  ["README.md", "what this app is and how to run it"],
  ["AGENTS.md", "the rules for people and tools editing this app"],
];

/** The kit's own guides: they live in the kit repository, not in an app, so they are named as such. */
const KIT_GUIDES = [
  ["docs/ARCHITECTURE.md", "how the kit works"],
  ["docs/recipes/", "how-to recipes (deploy, access, performance)"],
  ["SECURITY.md", "what the kit protects and what it does not"],
];

/**
 * @typedef {object} MenuOptions
 * @property {string} [cwd] default "."
 * @property {Record<string, string | undefined>} [env]
 * @property {{ plain?: boolean, noColor?: boolean, verbose?: boolean }} [globals]
 * @property {any} [input] @property {any} [output]
 * @property {(root: string, offline: boolean) => import("./checks.mjs").CheckResult[]} [checks] injected checks
 * @property {(cmd: string, args: string[], o: { cwd: string }) => Promise<number | null>} [spawn] runs an npm script with the terminal attached
 * @property {Partial<Record<"create" | "doctor" | "link" | "update" | "panel", (root: string) => Promise<{ lines: string[], code: number } | string[] | void>>>} [run] in-process commands
 * @property {string[]} [usage] the help text, for "Help"
 */

/** @param {string} p */
function exists(p) {
  try {
    return lstatSync(p) !== null;
  } catch {
    return false;
  }
}

/** Where the menu is running: an app (kit.lock.json), the kit repository, or anywhere else. @param {string} root @returns {"app" | "kit" | "empty"} */
export function whereAmI(root) {
  if (exists(join(root, LOCK_FILE))) return "app";
  if (existsSync(join(root, "packages", "server", "src")) && existsSync(join(root, "package.json"))) return "kit";
  return "empty";
}

/** The app's name for the header: product in app.config.mjs (read as text, never imported), else package.json name. @param {string} root */
export function productOf(root) {
  const read = (/** @type {string} */ f) => {
    try {
      return readFileSync(join(root, f), "utf8");
    } catch {
      return "";
    }
  };
  const m = /^\s*product:\s*"([^"\n]{1,80})"/m.exec(read("app.config.mjs"));
  if (m?.[1]) return printable(m[1]);
  try {
    const n = JSON.parse(read("package.json") || "{}").name;
    if (typeof n === "string" && n) return printable(n);
  } catch {
    /* fall through */
  }
  return printable(basename(root));
}

/** The kit version an app is on (from the lock), or "". @param {string} root */
export function kitVersionOf(root) {
  try {
    return printable(String(parseLock(readFileSync(join(root, LOCK_FILE), "utf8")).kit.version ?? ""));
  } catch {
    return "";
  }
}

/**
 * What the status line and the items need from the checks.
 * @param {import("./checks.mjs").CheckResult[]} results
 */
export function readiness(results) {
  const by = (/** @type {string} */ id) => results.find((r) => r.id === id);
  const update = by("kit-update");
  const newer = update?.status === "info" ? /\bto (\d+\.\d+\.\d+)/.exec(update.detail)?.[1] ?? "" : "";
  const link = by("project-link");
  return {
    newer,
    unlinked: link !== undefined && link.status !== "ok",
    // project-link and kit-update have their own parts of the status line (and a slow network must not read as a problem)
    problems: results.filter((r) => (r.status === "fail" || r.status === "warn") && r.id !== "project-link" && r.id !== "kit-update").length,
  };
}

/**
 * The items, in order. Unlinked moves "Connect" to the top and tags it.
 * @param {"app" | "kit" | "empty"} where @param {{ newer: string, unlinked: boolean }} st
 * @returns {Array<{ value: string, label: string, hint: string }>}
 */
export function menuItems(where, st) {
  if (where !== "app") {
    const cli = where === "kit" ? "npm run kit" : "node <path-to-kit>/packages/cli/src/bin.mjs";
    return [
      { value: "create", label: "Create a new app", hint: cli + (where === "kit" ? " -- create" : " create") },
      { value: "doctor", label: "Check my setup", hint: cli + (where === "kit" ? " -- doctor" : " doctor") },
      { value: "help", label: "Help", hint: "" },
    ];
  }
  const connect = { value: "link", label: "Connect to Google Apps Script", hint: "npm run kit -- link" + (st.unlinked ? "   needed" : "") };
  const rest = [
    { value: "preview", label: "Preview the app in my browser", hint: "npm run dev" },
    { value: "push", label: "Put the app online", hint: "npm run push" + (st.unlinked ? "   after linking" : "") },
    { value: "check", label: "Check that everything works", hint: "npm run check" },
    ...(st.newer ? [{ value: "update", label: "Update the kit to " + st.newer, hint: "npm run kit -- update" }] : []),
    { value: "doctor", label: "Fix my setup", hint: "npm run kit -- doctor" },
    { value: "panel", label: "Open the control panel in my browser", hint: "npm run kit -- ui" },
    { value: "guides", label: "Guides and help", hint: "" },
  ];
  const [preview, ...others] = rest;
  return st.unlinked ? [connect, /** @type {any} */ (preview), ...others] : [/** @type {any} */ (preview), connect, ...others];
}

/** Run an npm script with the terminal attached, no shell; Ctrl-C stops the child, not the menu. On Windows it runs npm-cli.js with node (npm.mjs); if that is not found the code is null and the menu says to run it by hand. @type {NonNullable<MenuOptions["spawn"]>} */
function inheritSpawn(cmd, args, { cwd }) {
  return new Promise((done) => {
    const keep = () => {};
    process.on("SIGINT", keep);
    const finish = (/** @type {number | null} */ code) => {
      process.off("SIGINT", keep);
      done(code);
    };
    try {
      const run = npmInvocation(cmd, args);
      const child = nodeSpawn(run.cmd, run.args, { cwd, stdio: "inherit", shell: false });
      child.on("error", () => finish(null));
      child.on("close", (code) => finish(code));
    } catch {
      finish(null);
    }
  });
}

/**
 * The real checks with the network capped at MENU_TIMEOUT_MS.
 * @param {string} root @param {Record<string, string | undefined>} env @param {boolean} offline
 */
export function realChecks(root, env, offline) {
  return runChecks(realContext({ root, env, offline, run: (c, a, o) => runCommand(c, a, { ...o, timeoutMs: Math.min(o.timeoutMs, MENU_TIMEOUT_MS, NETWORK_TIMEOUT_MS) }) }));
}

/**
 * Open the menu and loop until the person quits.
 * @param {MenuOptions} [opts]
 * @returns {Promise<{ lines: string[], code: number }>}
 */
export async function runMenu(opts = {}) {
  const env = opts.env ?? process.env;
  const root = resolve(opts.cwd ?? ".");
  const uiOpts = { input: opts.input, output: opts.output, env, flags: { plain: opts.globals?.plain === true, "no-color": opts.globals?.noColor === true } };
  const where = whereAmI(root);
  const checks = opts.checks ?? ((r, offline) => realChecks(r, env, offline));
  const spawn = opts.spawn ?? inheritSpawn;
  const run = opts.run ?? {};
  const say = (/** @type {string[]} */ lines) => ui.print(lines, uiOpts);
  let offline = false;
  let newer = "";

  for (;;) {
    const results = where === "empty" ? [] : checks(root, offline);
    const st = readiness(results);
    if (offline) st.newer = newer;
    else newer = st.newer;
    const header = where === "app" ? productOf(root) + "  · kit " + (kitVersionOf(root) || "unknown") : where === "kit" ? "gas-kit  · the kit repository" : "gas-kit  · no app in this folder";
    say(["", "  " + header, ""]);
    if (where !== "empty") {
      const parts = [st.problems ? "! " + st.problems + (st.problems === 1 ? " thing needs" : " things need") + " fixing" : "All checks pass"];
      if (st.newer) parts.push("↑ Kit " + st.newer + " is available");
      if (where === "app") parts.push(st.unlinked ? "Not linked to Google yet" : "Linked to Google");
      ui.report([{ status: st.problems ? "warn" : "ok", mark: "●", text: parts.join("    ") }], uiOpts);
      say([""]);
    }
    const items = menuItems(where, st);
    /** @type {string} */
    let pick;
    try {
      pick = await ui.select({
        ...uiOpts,
        message: "What do you want to do?",
        choices: items.map((i) => ({ value: i.value, label: i.label, ...(i.hint ? { hint: i.hint } : {}) })),
        keys: { q: "quit" },
        keyLabels: { q: "Quit" },
        footer: "↑↓ move · enter choose · 1-" + Math.min(9, items.length) + " pick by number · q quit",
      });
    } catch (e) {
      if (e instanceof ui.CancelError && e.by === "escape") return { lines: [], code: 0 };
      throw e;
    }
    if (pick === "quit") return { lines: [], code: 0 };
    offline = true;
    try {
      if (pick === "guides" || pick === "help") {
        const usage = opts.usage ? ["", ...opts.usage] : [];
        if (pick === "help") say(usage.length ? usage : [""]);
        else {
          // The docs address only when docsUrlOf validated it (GAS_KIT_DOCS_URL or the app's docsUrl).
          const docs = where === "app" ? docsUrlOf(root, env) : null;
          say(["", "  Guides in this app:", ...GUIDES.filter(([f]) => exists(join(root, f))).map(([f, why]) => "    " + f + "   " + why), "", "  Guides in the kit repository (not copied into apps):", ...KIT_GUIDES.map(([f, why]) => "    " + f + "   " + why), ...(docs ? ["", "  Docs: " + docs] : []), ...usage, ""]);
        }
        continue;
      }
      const script = /** @type {Record<string, string>} */ (SCRIPTS)[pick];
      if (script) {
        say(["", "  Running npm run " + script + " …", ""]);
        const code = await spawn("npm", ["run", script], { cwd: root });
        say(["", code === 0 ? "  ✔ npm run " + script + " finished" : "  ✖ npm run " + script + " did not finish" + (code === null ? " (run npm run " + script + " yourself in this folder)" : " (exit code " + code + ")"), ""]);
        continue;
      }
      const fn = /** @type {any} */ (run)[pick];
      if (!fn) continue;
      const res = await fn(root);
      const lines = Array.isArray(res) ? res : (res?.lines ?? []);
      if (lines.length) say(lines);
      if (pick === "update") offline = false;
      if (pick === "link" || pick === "update") say([""]);
    } catch (e) {
      if (e instanceof ui.CancelError && e.by !== "escape") throw e;
      if (e instanceof ui.CancelError) continue;
      say(["", ...formatError(e, { verbose: opts.globals?.verbose === true }), ""]);
    }
  }
}
