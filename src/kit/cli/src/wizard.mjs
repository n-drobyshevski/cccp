// The guided create: questions in plain words, a summary, a progress list, one next step. Runs only on two
// terminals with no --yes (create.mjs decides). Everything it shows goes through ui.mjs, which sanitises each
// dynamic string; nothing is written to disk until the person confirms the summary, so Ctrl-C or Esc leaves
// nothing behind. The scaffold itself is create.mjs: it hands its functions in, so there is no import cycle.
import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { npmInvocation } from "./npm.mjs";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { printable } from "./source.mjs";
import { ACCENT_PRESETS } from "./color.mjs";
import { FriendlyError, formatError } from "./errors.mjs";
import * as ui from "./ui.mjs";
import { UsageError } from "./args.mjs";
import { checkAccent, checkProduct, checkTz, resolveValues, slugFromDir, validateValues } from "./values.mjs";

/**
 * @typedef {(cmd: string, args: string[], o: { cwd: string }) => Promise<{ code: number | null, stderr: string }>} Spawner
 * @typedef {object} WizardApi
 * @property {(root: string, kitRoot: string, force: boolean) => string | null} targetProblem
 * @property {(root: string, kitRoot: string, kitRemote: string | null | false) => number} copyKit
 * @property {(root: string, values: import("./values.mjs").Values) => Promise<void>} applyChoices
 * @property {(root: string, values: import("./values.mjs").Values) => string | null} firstCommit
 */

/**
 * Quote one argument for a POSIX shell: bare when it is plainly safe, else in single quotes with each
 * single quote written as '\''. Nothing inside single quotes (a $, a backtick, a newline, a space) is
 * interpreted. Windows cmd.exe has other rules; the printed command is for a POSIX shell.
 * @param {string} s
 */
export function shellQuote(s) {
  if (/^[A-Za-z0-9_@%+:,./][A-Za-z0-9_@%+=:,./-]*$/.test(s)) return s; // a leading - or = is quoted: an option, or zsh's =cmd
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** A path as one shell word; a relative path that starts with a dash gets ./ so cd and the CLI read a path. @param {string} p */
function pathWord(p) {
  return shellQuote(p.startsWith("-") ? "./" + p : p);
}

/**
 * The non-interactive command that makes the same app: every chosen value as a flag, each quoted.
 * Wrapped with a trailing backslash on token boundaries only, so a quoted value is never split.
 * @param {import("./values.mjs").Values} v
 * @param {string} target the folder as the person would type it
 * @param {Record<string, string | boolean>} flags the flags the run was given (force, e2e, kit-remote carry over)
 * @returns {string[]}
 */
export function equivalentCommand(v, target, flags) {
  /** @type {string[]} */
  const t = ["npm run create --", pathWord(target), "--yes", "--name", shellQuote(v.name), "--product", shellQuote(v.product), "--prefix", shellQuote(v.prefix), "--accent", shellQuote(v.accent), "--access", v.access, "--source", v.source, "--tz", shellQuote(v.tz)];
  if (v.confidential) t.push("--confidential");
  if (v.git) t.push("--git");
  if (flags["e2e"] === false) t.push("--no-e2e");
  if (typeof flags["kit-remote"] === "string") t.push("--kit-remote", shellQuote(flags["kit-remote"]));
  if (flags["force"] === true) t.push("--force");
  /** @type {string[]} */
  const lines = [];
  let cur = "";
  for (const tok of t) {
    if (cur && (cur + " " + tok).length > 72) {
      lines.push(cur + " \\");
      cur = "  " + tok;
    } else cur = cur ? cur + " " + tok : tok;
  }
  lines.push(cur);
  return lines;
}

/** Run npm without a shell, so no argument is ever parsed by one. @type {Spawner} */
function spawnNpm(cmd, args, { cwd }) {
  return new Promise((done) => {
    let stderr = "";
    try {
      const run = npmInvocation(cmd, args);
      const child = nodeSpawn(run.cmd, run.args, { cwd, stdio: ["ignore", "ignore", "pipe"], shell: false });
      child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      child.on("error", (e) => done({ code: null, stderr: e.message }));
      child.on("close", (code) => done({ code, stderr }));
    } catch (e) {
      done({ code: null, stderr: /** @type {Error} */ (e).message });
    }
  });
}

/** @returns {boolean} */
function gitOnPath() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The computer's time zone when it is a valid IANA zone, else UTC. */
function detectedTz() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && !checkTz(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * @param {{ parsed: { positional: string[], flags: Record<string, string | boolean> }, kitRoot: string, kitRemote: string | null | false, uiOpts: any, cwd?: string, verbose: boolean, spawn?: Spawner, hasGit?: boolean, detectTz?: () => string }} ctx
 * @param {WizardApi} api
 */
export async function runWizard(ctx, api) {
  const { parsed, kitRoot, kitRemote, uiOpts } = ctx;
  const flags = parsed.flags;
  const force = flags["force"] === true;
  const dirFlag = parsed.positional[0];
  const str = (/** @type {string} */ k) => (typeof flags[k] === "string" ? /** @type {string} */ (flags[k]) : undefined);
  const hasGit = ctx.hasGit ?? gitOnPath();
  const tzHere = (() => {
    const tz = (ctx.detectTz ?? detectedTz)();
    return tz && !checkTz(tz) ? tz : "UTC";
  })();
  /** Where the person is: npm runs this in the kit folder, and sets INIT_CWD to the folder they ran npm from. */
  const baseDir = ctx.cwd ?? (process.env["INIT_CWD"] && isAbsolute(process.env["INIT_CWD"]) ? process.env["INIT_CWD"] : process.cwd());
  // A flag that is wrong is reported before any question, as it is without the wizard.
  validateValues(resolveValues(flags, dirFlag ? basename(resolve(dirFlag)) : "register-app"));
  if (dirFlag !== undefined) {
    if (/[\u0000-\u001f\u007f-\u009f]/.test(dirFlag)) throw new UsageError("a folder name cannot contain control characters", { title: "That folder name has a hidden character", why: "Names with control characters could repaint your terminal.", fix: "Type the folder name again, with plain letters.", more: "npm run kit -- help" });
    const early = api.targetProblem(resolve(dirFlag), kitRoot, force);
    if (early) throw new UsageError(early, { title: "gas-kit cannot create the app there", why: printable(early) + ".", fix: "Pick another folder, or add --force to use a folder that is not empty.", more: "npm run kit -- help" });
  }

  /** @type {{ product?: string, dir?: { here: true } | { typed: string }, confidential?: boolean, access?: "list" | "org", accent?: string, source?: "none" | "sheet", tz?: string, git?: boolean, install?: boolean }} */
  const a = {};
  /** The slug base: the folder's name when one was given, else what the app is called. */
  const base = () => (dirFlag ? basename(resolve(dirFlag)) : slugFromDir(a.product ?? str("product") ?? ""));
  const values = () =>
    resolveValues(
      {
        ...flags,
        ...(a.product !== undefined ? { product: a.product } : {}),
        ...(a.confidential !== undefined ? { confidential: a.confidential } : {}),
        ...(a.access ? { access: a.access } : {}),
        ...(a.accent ? { accent: a.accent } : {}),
        ...(a.source ? { source: a.source } : {}),
        ...(a.tz ? { tz: a.tz } : {}),
        ...(a.git !== undefined ? { git: a.git } : {}),
      },
      base(),
    );
  const isConfidential = () => flags["confidential"] === true || a.confidential === true;
  const slug = () => values().name;
  /** The new folder next to where the person is, or next to the kit when that is inside the kit. */
  const hereAbs = () => {
    const mine = resolve(baseDir, slug());
    return api.targetProblem(mine, kitRoot, true) ? resolve(kitRoot, "..", slug()) : mine;
  };
  /** @param {string} abs */
  const shown = (abs) => {
    const rel = relative(baseDir, abs);
    return !rel || isAbsolute(rel) ? abs : rel.startsWith("..") ? rel : "./" + rel;
  };
  const dirAbs = () => (dirFlag !== undefined ? resolve(dirFlag) : a.dir && "typed" in a.dir ? resolve(baseDir, a.dir.typed) : hereAbs());
  /** An .npmrc already in a folder used with --force is kept, and npm install would obey it. */
  const hasNpmrc = () => force && existsSync(join(dirAbs(), ".npmrc"));
  const dirShown = () => (dirFlag !== undefined ? dirFlag : a.dir && "typed" in a.dir ? a.dir.typed : shown(hereAbs()));
  /** What the person already typed for a question they are redoing. @type {{ product?: string }} */
  const last = {};

  /** @type {Array<{ key: keyof typeof a, label: string, skipped: () => boolean, ask: () => Promise<void> }>} */
  const questions = [
    {
      key: "product",
      label: "Name",
      skipped: () => str("product") !== undefined,
      async ask() {
        a.product = await ui.text({ ...uiOpts, message: "What is your app called?", hint: "Shown at the top of every page. You can change it later.", initial: last.product, placeholder: "Acme Supplier Register", validate: checkProduct });
      },
    },
    {
      key: "dir",
      label: "Folder",
      skipped: () => dirFlag !== undefined,
      async ask() {
        const here = shown(hereAbs());
        const problem = api.targetProblem(hereAbs(), kitRoot, force);
        const where = await ui.select({
          ...uiOpts,
          message: "Where should it go?",
          choices: [
            { value: "here", label: here, hint: "(a new folder here)", disabled: problem ?? false },
            { value: "else", label: "Somewhere else…" },
          ],
        });
        if (where === "here") a.dir = { here: true };
        else {
          const typed = await ui.text({
            ...uiOpts,
            message: "Which folder?",
            hint: "A path, for example ../acme-register. It is created if it does not exist.",
            validate: (v) => (!v ? "Type a folder" : /[\u0000-\u001f\u007f-\u009f]/.test(v) ? "A folder name cannot contain control characters" : api.targetProblem(resolve(baseDir, v), kitRoot, force)),
          });
          a.dir = { typed };
        }
      },
    },
    {
      key: "confidential",
      label: "Personal information",
      skipped: () => flags["confidential"] === true || str("access") === "org", // org access cannot hold confidential data: the answer can only be No
      async ask() {
        a.confidential = await ui.select({
          ...uiOpts,
          message: "Will it hold personal or confidential information?",
          hint: "For example salaries, health details, contracts or ID numbers.",
          initial: false,
          choices: [
            { value: true, label: "Yes, turn on extra protection", hint: "only listed people, an audit log, downloads for admins only" },
            { value: false, label: "No" },
          ],
        });
      },
    },
    {
      key: "access",
      label: "Who can open it",
      skipped: () => str("access") !== undefined || isConfidential(),
      async ask() {
        a.access = await ui.select({
          ...uiOpts,
          message: "Who should be able to open the app?",
          choices: [
            { value: "list", label: "Only people I list", hint: "you add their emails in Settings" },
            { value: "org", label: "Anyone in my organisation", hint: "everyone with an account on your organisation's Google domain" },
          ],
        });
      },
    },
    {
      key: "accent",
      label: "Colour",
      skipped: () => str("accent") !== undefined,
      async ask() {
        const pick = await ui.select({
          ...uiOpts,
          message: "Pick a main colour",
          hint: "Buttons, links and the focus ring use it. Text stays readable on it.",
          choices: [
            ...ACCENT_PRESETS.map((p) => ({ value: p.accent, label: p.label, hint: p.accent, swatch: p.accent })),
            { value: "custom", label: "My own (#rrggbb)" },
          ],
        });
        a.accent = pick === "custom" ? (await ui.text({ ...uiOpts, message: "Which colour?", hint: "Six hex digits after a #, for example #2a5fc4.", placeholder: "#2a5fc4", validate: checkAccent })).toLowerCase() : pick;
      },
    },
    {
      key: "source",
      label: "Data",
      skipped: () => str("source") !== undefined,
      async ask() {
        a.source = await ui.select({
          ...uiOpts,
          message: "Where does the data come from?",
          choices: [
            { value: "sheet", label: "A Google Sheet", hint: "you connect it after the app is online" },
            { value: "none", label: "Nothing yet", hint: "start with sample data" },
          ],
        });
      },
    },
    {
      key: "tz",
      label: "Time zone",
      skipped: () => str("tz") !== undefined,
      async ask() {
        const pick = await ui.select({
          ...uiOpts,
          message: "Time zone for dates",
          choices: [
            { value: tzHere, label: tzHere, hint: "(this computer's time zone)" },
            { value: "", label: "Choose another…" },
          ],
        });
        a.tz = pick || (await ui.text({ ...uiOpts, message: "Which time zone?", hint: "An IANA name such as Europe/Berlin or America/Chicago.", placeholder: "Europe/Berlin", validate: checkTz }));
      },
    },
    {
      key: "git",
      label: "First version",
      skipped: () => flags["git"] === true || !hasGit,
      async ask() {
        a.git = await ui.confirm({ ...uiOpts, message: "Save a first version with git?", hint: "A first commit, so you can see later what changed." });
      },
    },
    {
      key: "install",
      label: "Install the tools",
      skipped: () => false,
      async ask() {
        a.install = await ui.confirm({
          ...uiOpts,
          message: "Install the app's tools now? (npm install, about a minute)",
          hint: hasNpmrc() ? "That folder already has an .npmrc, which npm install would obey, so the answer starts as No." : undefined,
          initial: !hasNpmrc(),
        });
      },
    },
  ];

  /** Ask what is still unanswered; a question that no longer applies loses its answer. */
  const fill = async () => {
    for (const q of questions) {
      if (q.skipped()) delete a[q.key];
      else if (a[q.key] === undefined) await q.ask();
    }
  };
  /** @param {string} accent */
  const colourName = (accent) => {
    const p = ACCENT_PRESETS.find((x) => x.accent === accent);
    return (p ? p.label : "Custom") + " " + accent;
  };

  await fill();

  for (;;) {
    const v = values();
    validateValues(v);
    ui.summary(
      "Ready to create",
      [
        ["Name", v.product],
        ["Folder", dirShown()],
        ["Access", v.access === "list" ? "Only people I list" : "Anyone in my organisation"],
        ["Data", v.confidential ? "Confidential (extra protection on)" : "Not confidential"],
        ["Colour", colourName(v.accent)],
        ["Source", v.source === "sheet" ? "A Google Sheet (connect later)" : "Nothing yet (sample data)"],
        ["Time zone", v.tz],
        ["Tools", a.install ? "Install now (npm install)" : "Install later"],
      ],
      uiOpts,
    );
    ui.note("Also set: slug " + v.name + ", storage prefix " + v.prefix, { ...uiOpts, dim: true });
    const go = await ui.select({
      ...uiOpts,
      message: "Create it?",
      choices: [
        { value: true, label: "Yes" },
        { value: false, label: "Change an answer" },
      ],
    });
    if (go) break;
    const open = questions.filter((q) => !q.skipped());
    if (!open.length) continue;
    const which = await ui.select({ ...uiOpts, message: "Which answer?", choices: open.map((q) => ({ value: q.key, label: q.label })) });
    last.product = a.product;
    delete a[/** @type {keyof typeof a} */ (which)];
    await fill();
  }

  const v = values();
  validateValues(v);
  const root = dirAbs();
  const target = dirShown();
  const problem = api.targetProblem(root, kitRoot, force);
  if (problem) throw new UsageError(problem, { title: "gas-kit cannot create the app there", why: printable(problem) + ".", fix: "Pick another folder, or add --force to use a folder that is not empty.", more: "npm run kit -- help" });
  const cd = "cd " + pathWord(dirFlag !== undefined || (a.dir !== undefined && "typed" in a.dir) ? root : target);

  await ui.steps(
    [
      { title: "Copying the kit", run: () => api.copyKit(root, kitRoot, kitRemote), doneTitle: (n, took) => "Copied the kit (" + n + " files, " + took + ")", inlineTime: true },
      { title: "Applying your name and colour", run: () => api.applyChoices(root, v), doneTitle: (_r, took) => "Applied your name and colour (" + took + ")", inlineTime: true },
    ],
    uiOpts,
  );

  let installed = false;
  if (a.install) {
    const spawn = ctx.spawn ?? spawnNpm;
    try {
      await ui.steps(
        [
          {
            title: "Installing the app's tools (npm install, about a minute)",
            async run() {
              const r = await spawn("npm", ["install"], { cwd: root });
              if (r.code !== 0) throw new Error("npm install exited with " + (r.code === null ? "an error" : "code " + r.code) + (r.stderr ? "\n" + r.stderr.trim() : ""));
            },
            doneTitle: (_r, took) => "Installed the app's tools (npm install, " + took + ")",
            inlineTime: true,
          },
        ],
        uiOpts,
      );
      installed = true;
    } catch (e) {
      // Not fatal: the app is on disk. Say how to finish by hand, and carry on.
      const fe = new FriendlyError({
        title: "The app's tools did not install",
        why: "npm install did not finish. Your app is created; only this step is missing.",
        fix: cd + " && npm install",
        detail: /** @type {Error} */ (e).message,
      });
      ui.print(formatError(fe, { verbose: ctx.verbose }), uiOpts);
    }
  }

  if (v.git) {
    try {
      await ui.steps(
        [
          {
            title: "Saving a first version (git)",
            run() {
              const why = api.firstCommit(root, v);
              if (why) throw new Error(why);
            },
            doneTitle: (_r, took) => "Saved a first version (git, " + took + ")",
            inlineTime: true,
          },
        ],
        uiOpts,
      );
    } catch (e) {
      ui.print(["  " + /** @type {Error} */ (e).message], uiOpts);
    }
  }

  ui.outro("Your app is ready.", uiOpts);
  ui.print(["", "   Next:  " + cd + (installed ? "" : " && npm install") + " && npm run kit", "          opens a menu: preview the app, connect to Google, put it online"], uiOpts);
  if (v.confidential) ui.print(["", "   Before anyone opens it: run setup() in the Apps Script editor, signed in as the deploying account."], uiOpts);
  ui.print([""], uiOpts);
  ui.print(["   Same app again, no questions:", ...equivalentCommand(v, root, flags).map((l) => "   " + l)], { ...uiOpts, dim: true });
}
