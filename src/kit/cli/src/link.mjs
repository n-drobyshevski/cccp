// `link`: connect an app to an Apps Script project without editing JSON. Plain output goes through main's out();
// the interactive session prints through ui.mjs, which sanitises. The only things written are .clasp.json (never
// through a symlink) and, on request, a fixed URL handed to the platform opener (spawned with no shell).
import { spawn as nodeSpawn } from "node:child_process";
import { lstatSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "./args.mjs";
import { claspCredentialFiles, noLocalBrowser, realContext } from "./checks.mjs";
import { runFix } from "./doctor.mjs";
import { FriendlyError } from "./errors.mjs";
import { LOCK_FILE } from "./hash.mjs";
import { printable } from "./source.mjs";
import * as ui from "./ui.mjs";
import { assertNoLink } from "./vendor.mjs";

/** The only keys copied from .clasp.json.example: clasp's project settings, never credentials or anything unknown. */
const EXAMPLE_KEYS = ["rootDir", "fileExtension", "filePushOrder", "skipSubdirectories", "parentId", "projectId"];
const DEFAULTS = () => ({ scriptId: "", rootDir: "dist" });

/** @param {string} root @returns {void} refuses a .clasp.json that is a link, as a friendly message */
function refuseLink(root) {
  try {
    assertNoLink(root, ".clasp.json", { deep: false, who: "link", hint: "" });
  } catch (e) {
    throw new FriendlyError({ title: ".clasp.json is a link, so link will not write to it", why: "Writing through a link could change a file outside this app.", fix: "Delete .clasp.json (it is only a link), then run npm run kit -- link again.", detail: /** @type {Error} */ (e).message, exitCode: 2 });
  }
}

/** The only URL link ever opens in a browser. Fixed: no user text reaches the opener. */
export const CREATE_URL = "https://script.google.com/create";
const ID_RE = /^[A-Za-z0-9_-]{20,120}$/;
const NEXT = "Linked. Next: Put the app online from the menu, or npm run push";

/** @param {string} input @returns {FriendlyError} */
function badAddress(input) {
  return new FriendlyError({
    title: "That does not look like an Apps Script project address",
    why: "Expected https://script.google.com/home/projects/<id>/edit, https://script.google.com/d/<id>/edit, or the id on its own (20 to 120 letters, digits, - and _).",
    fix: "Open your project in script.google.com and copy the address from the browser bar.",
    detail: "unrecognised script address " + JSON.stringify(printable(input.slice(0, 200))),
    exitCode: 2,
  });
}

/**
 * The project's script id from what a person pasted: the editor address, or the id itself. Anything else is refused:
 * only https on exactly script.google.com (no credentials, no port), and the id must match ^[A-Za-z0-9_-]{20,120}$.
 * A web app deployment address (/macros/s/<id>/exec) is a deployment, not a project, and says so.
 * @param {string} input
 * @returns {string}
 */
export function parseScriptId(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 2048) throw badAddress(raw);
  if (/^script\.google\.com\//i.test(raw)) return parseScriptId("https://" + raw);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    if (!ID_RE.test(raw)) throw badAddress(raw);
    return raw;
  }
  /** @type {URL} */
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badAddress(raw);
  }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.username || url.password || url.port) throw badAddress(raw);
  const seg = url.pathname.split("/").filter(Boolean);
  if (seg[0] === "u" && /^\d{1,3}$/.test(seg[1] ?? "")) seg.splice(0, 2);
  if ((seg[0] === "macros" && (seg[1] === "s" || seg[1] === "d")) || (seg[0] === "a" && seg.includes("macros"))) {
    throw new FriendlyError({
      title: "That is a web app address, not a project address",
      why: "An address with /macros/ in it (usually ending in /exec) is a deployment. The project is the page where you edit the code.",
      fix: "Open the project in script.google.com and copy its address, which looks like https://script.google.com/home/projects/<id>/edit",
      detail: "deployment address given as the script id",
      exitCode: 2,
    });
  }
  /** @type {string | undefined} */
  let id;
  if (seg[0] === "home" && seg[1] === "projects" && seg.length <= 4 && (seg[3] === undefined || seg[3] === "edit") && (seg[2] !== undefined)) id = seg[2];
  else if (seg[0] === "d" && seg.length <= 3 && (seg[2] === undefined || seg[2] === "edit")) id = seg[1];
  if (id === undefined || !ID_RE.test(id)) throw badAddress(raw);
  return id;
}

/** @param {string} p */
function lstat(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Read the object to write: .clasp.json when there is one (other keys kept), else the known settings of
 * .clasp.json.example, else defaults. Only regular files are read (a link or a pipe is never opened), and from the
 * example only EXAMPLE_KEYS are taken, so a planted example cannot smuggle other content into .clasp.json.
 * @param {string} root
 * @returns {{ data: Record<string, unknown>, existed: boolean }}
 */
function readClasp(root) {
  const real = join(root, ".clasp.json");
  const st = lstat(real);
  if (st && !st.isFile()) {
    throw new FriendlyError({ title: "Cannot read .clasp.json", why: "It is not a plain file, so link will not open or replace it.", fix: "Delete it, then run npm run kit -- link again.", detail: real + " is not a regular file", exitCode: 2 });
  }
  const ex = join(root, ".clasp.json.example");
  const exst = lstat(ex);
  if (!st && !(exst && exst.isFile())) return { data: DEFAULTS(), existed: false };
  const from = st ? real : ex;
  let data;
  try {
    data = JSON.parse(readFileSync(from, "utf8"));
  } catch {
    data = undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new FriendlyError({ title: "Cannot read " + (st ? ".clasp.json" : ".clasp.json.example"), why: "It is not a JSON object, so link will not guess what to keep.", fix: "Fix or delete the file, then run npm run kit -- link again.", detail: from + " is not a JSON object" });
  }
  if (st) return { data: /** @type {Record<string, unknown>} */ (data), existed: true };
  /** @type {Record<string, unknown>} */
  const out = { scriptId: "" };
  for (const k of EXAMPLE_KEYS) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = /** @type {any} */ (data)[k];
  if (!("rootDir" in out)) out["rootDir"] = "dist";
  return { data: out, existed: false };
}

/**
 * Open the fixed create URL with the platform opener: no shell, no user text, failures ignored.
 * @param {string} url
 * @returns {void}
 */
export function openInBrowser(url) {
  if (url !== CREATE_URL) throw new Error("link only opens its own fixed address");
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = nodeSpawn(/** @type {string} */ (cmd), /** @type {string[]} */ (args), { stdio: "ignore", shell: false, detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is printed too, so a failure here costs nothing.
  }
}

/**
 * @typedef {object} LinkOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {{ plain?: boolean, noColor?: boolean }} [globals]
 * @property {any} [input] @property {any} [output]
 * @property {Partial<import("./checks.mjs").CheckContext>} [context] overrides for tests
 * @property {import("./doctor.mjs").FixRunner} [spawn] runs clasp login (tests)
 * @property {(url: string) => void} [open] opens the create URL (tests)
 */

/**
 * @param {{ positional: string[], flags: Record<string, string | boolean> }} parsed
 * @param {LinkOptions} [opts]
 * @returns {Promise<{ lines: string[], code: number }>} lines for main's out() (empty after an interactive session)
 */
export async function runLink(parsed, opts = {}) {
  const env = opts.env ?? process.env;
  const rootFlag = parsed.flags["root"];
  if (rootFlag === "") throw new UsageError("--root needs a folder", { title: "--root needs a folder", why: "The flag was given with nothing after it.", fix: "Write --root <your app's folder>, or leave it out to use this folder.", more: "npm run kit -- help" });
  const root = resolve(typeof rootFlag === "string" ? rootFlag : ".");
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new UsageError("--root " + JSON.stringify(printable(root)) + " is not a folder that exists; pass your app's folder", { title: "That folder does not exist", why: printable(root) + " is not a folder on this computer.", fix: "Pass your app's folder: --root <folder>, or open a terminal inside it.", more: "npm run kit -- help" });
  if (!lstat(join(root, LOCK_FILE))) {
    throw new FriendlyError({ title: "This folder is not a gas-kit app", why: "There is no " + LOCK_FILE + " here.", fix: "Run npm run kit -- link from your app's folder, or pass --root <folder>.", detail: "no " + LOCK_FILE + " in " + root, exitCode: 2 });
  }
  const uiOpts = { input: opts.input, output: opts.output, env, flags: { ...parsed.flags, plain: opts.globals?.plain === true, "no-color": opts.globals?.noColor === true } };
  const interactive = ui.isInteractive(uiOpts);
  const given = parsed.flags["script"];
  if (given === "" || (typeof given !== "string" && given !== undefined)) throw new UsageError("--script needs a project address or id", { title: "--script needs the project address", why: "The flag was given with nothing after it.", fix: "Paste the web address of the Apps Script project after --script.", more: "npm run kit -- help link" });
  if (given === undefined && !interactive) throw new UsageError("link needs --script <project address | id> when it cannot ask (no terminal, CI or --yes)", { title: "link needs the project address", why: "There is no terminal to ask on, so gas-kit cannot ask for it.", fix: "npm run kit -- link --script <project address>", more: "npm run kit -- help link" });
  // Check the id before anything is asked or written.
  let id = given === undefined ? "" : parseScriptId(given);
  const say = (/** @type {string[]} */ lines) => ui.print(lines, uiOpts);
  // A link or an unreadable file fails now, before the person has signed in, created or pasted anything.
  refuseLink(root);
  const { data, existed } = readClasp(root);
  // The id already in .clasp.json. A value that is not a string (a number, an object) still counts as an id: it is never replaced unasked.
  const had = existed ? data["scriptId"] : undefined;
  const old = typeof had === "string" ? had.trim() : had === undefined || had === null || had === "" ? "" : printable(JSON.stringify(had));
  let replaceAsked = false;

  if (interactive && given === undefined && old && parsed.flags["force"] !== true) {
    // Say so before the three steps, not after them.
    say(["", "  This app is already linked to " + printable(old) + "."]);
    if (!(await ui.confirm({ ...uiOpts, message: "Connect it to a different project instead?", initial: false }))) {
      say(["  The same in one line: npm run kit -- link --script " + printable(old)]);
      ui.outro("Nothing was changed.", uiOpts);
      return { lines: [], code: 0 };
    }
    replaceAsked = true;
  }

  if (interactive) {
    say(["", "  Connect this app to a Google Apps Script project.", ""]);
    // 1 Sign in. Existence of the credentials file only; it is never opened.
    const cctx = realContext({ root, env, ...opts.context });
    const signedIn = claspCredentialFiles(cctx).some((p) => {
      const st = lstat(p);
      return st !== null && st.isFile() && st.size > 0;
    });
    if (signedIn) say(["  1  Sign in to Google            ✔ signed in"]);
    else {
      say(["  1  Sign in to Google            ✖ not signed in yet"]);
      const command = ["npx", "clasp", "login", ...(noLocalBrowser(env) ? ["--no-localhost"] : [])];
      if (noLocalBrowser(env)) say(["  No browser on this machine (Cloud Shell or ssh), so sign-in gives you a link to open on another computer."]);
      if (await ui.confirm({ ...uiOpts, message: "Sign in now? This runs " + command.join(" "), initial: true })) {
        const status = await runFix(command, root, opts.spawn);
        say([status === 0 ? "  ✔ " + command.join(" ") + " finished" : "  ✖ " + command.join(" ") + " did not finish. You can run it yourself later."]);
      } else say(["  ! Skipped. Before you put the app online, run: npx clasp login"]);
    }
    // 2 Create an empty project (only when the address was not given).
    if (given === undefined) {
      const open = await ui.select({
        ...uiOpts,
        message: "2  Create an empty project",
        choices: [
          { value: true, label: "Open script.google.com in my browser", hint: "New project, then copy its address" },
          { value: false, label: "I already have a project" },
        ],
        initial: true,
      });
      if (open) {
        say(["  Create it here: " + CREATE_URL]);
        if (!noLocalBrowser(env)) (opts.open ?? openInBrowser)(CREATE_URL);
        else say(["  No browser on this machine (Cloud Shell or ssh), so open that address on another computer."]);
      }
      id = parseScriptId(await ui.text({ ...uiOpts, message: "3  Paste the project's web address (copy it from the browser bar)", placeholder: "https://script.google.com/home/projects/.../edit", validate: (v) => { try { parseScriptId(v); return null; } catch (e) { return /** @type {Error} */ (e) instanceof FriendlyError ? /** @type {FriendlyError} */ (e).title : "not an address"; } } }));
    }
  }

  if (existed && old === id) {
    const lines = ["Already linked to this project (script id " + id + ").", NEXT];
    if (!interactive) return { lines, code: 0 };
    say(["  ✔ Already linked to " + id, "  The same in one line: npm run kit -- link --script " + id]);
    ui.outro(NEXT, uiOpts);
    return { lines: [], code: 0 };
  }
  if (old && parsed.flags["force"] !== true && !replaceAsked) {
    if (!interactive) {
      throw new FriendlyError({ title: "This app is already linked to another project", why: "link will not replace the script id " + printable(old) + " unless you say so.", fix: "Add --force to replace it.", detail: ".clasp.json already has a different scriptId", exitCode: 2 });
    }
    if (!(await ui.confirm({ ...uiOpts, message: "This app is already linked to " + printable(old) + ". Replace it with " + id + "?", initial: false }))) throw new ui.CancelError();
  }
  data["scriptId"] = id;
  // Write beside it and rename over it: a rename replaces a link, it never writes through one.
  refuseLink(root);
  const target = join(root, ".clasp.json");
  const tmpFile = join(root, ".clasp.json." + process.pid + ".tmp");
  try {
    writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
    renameSync(tmpFile, target);
  } catch (e) {
    rmSync(tmpFile, { force: true });
    throw e;
  }
  if (interactive) {
    say(["", "  ✔ Found the script id " + id, "  ✔ Saved it to .clasp.json", "  The same in one line: npm run kit -- link --script " + id]);
    ui.outro(NEXT, uiOpts);
    return { lines: [], code: 0 };
  }
  return { lines: ["Saved script id " + id + " to .clasp.json.", NEXT], code: 0 };
}
