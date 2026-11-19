// `update`: one guided kit upgrade. Lists the release tags (vX.Y.Z or X.Y.Z) of the remembered kit remote,
// shows what changes for this app, then applies the chosen release through the existing sync (pinned to the
// full commit that was shown), verifyUpstream and `npm run check`. Never loosens a trust check: the fetch is
// resolveSource (https or ssh, a commit proved to be on a branch or tag), the write is runSync.
// Plain output goes through main's out(); the interactive session prints through ui.mjs, which sanitises.
// Everything read from the remote (tag names, CHANGELOG.md, file names) is untrusted text.
import { spawn as nodeSpawn } from "node:child_process";
import { npmInvocation } from "./npm.mjs";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { UsageError } from "./args.mjs";
import { parseSemver } from "./checks.mjs";
import { FriendlyError } from "./errors.mjs";
import { KIT_DIR, LOCK_FILE, hashFiles, sha256, vendorFiles, walkFiles } from "./hash.mjs";
import { gitIn, runGit } from "./git.mjs";
import { describeGuardChanges, guardChanges } from "./guards.mjs";
import { importSpecifiers } from "./imports.mjs";
import { assertFetchable, isFullCommit, isGitUrl, printable, resolveSource, splitSource } from "./source.mjs";
import { readLock, resolveFrom, runSync, summarize } from "./sync.mjs";
import * as ui from "./ui.mjs";
import { formatProblems, verifyUpstream } from "./verify.mjs";

/** The template files an app derives from the kit: shown as "Review these in your app". */
export const TEMPLATE_PATHS = ["templates/register/tools", "templates/register/test/contracts.test.ts", "templates/register/eslint.config.js"];

const MAX_TEXT = 1024 * 1024;
const NETWORK_TIMEOUT_MS = 30000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One printable line: control characters shown as "?" (ui.sanitize). @param {unknown} s */
const clean = (s) => ui.sanitize(s);

/** @param {number[]} a @param {number[]} b negative when a is older than b */
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/**
 * The release tags in `git ls-remote --tags` output: strict vX.Y.Z or X.Y.Z only, every other name (a
 * prerelease, a hostile or odd one) ignored. A peeled entry (name^{}) gives the commit of an annotated tag.
 * Newest first. When both v1.2.3 and 1.2.3 exist, the v form is kept.
 * @param {string} text
 * @returns {Array<{ version: string, name: string, commit: string, nums: number[] }>}
 */
export function parseTags(text) {
  /** @type {Map<string, { name: string, commit: string }>} */
  const direct = new Map();
  /** @type {Map<string, string>} */
  const peeled = new Map();
  for (const line of String(text).split("\n")) {
    const m = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (!m) continue;
    const name = /** @type {string} */ (m[2]);
    if (!parseSemver(name)) continue;
    if (m[3]) peeled.set(name, /** @type {string} */ (m[1]));
    else direct.set(name, { name, commit: /** @type {string} */ (m[1]) });
  }
  /** @type {Map<string, { version: string, name: string, commit: string, nums: number[] }>} */
  const byVersion = new Map();
  for (const [name, t] of [...direct].sort((a, b) => a[0].localeCompare(b[0]))) {
    const nums = /** @type {number[]} */ (parseSemver(name));
    const version = nums.join(".");
    const prev = byVersion.get(version);
    if (prev && !name.startsWith("v")) continue;
    byVersion.set(version, { version, name, commit: peeled.get(name) ?? t.commit, nums });
  }
  return [...byVersion.values()].sort((a, b) => cmp(b.nums, a.nums));
}

/**
 * The sections of a CHANGELOG.md: each "## <heading>" with its lines. A heading counts as a release when it
 * starts with X.Y.Z, vX.Y.Z or [X.Y.Z].
 * @param {string} text
 * @returns {Array<{ heading: string, nums: number[] | null, lines: string[] }>}
 */
export function parseChangelog(text) {
  /** @type {Array<{ heading: string, nums: number[] | null, lines: string[] }>} */
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      const heading = /** @type {string} */ (h[1]).trim();
      const v = /^\[?(v?\d{1,6}\.\d{1,6}\.\d{1,6})\]?(?:[\s(–-]|$)/.exec(heading);
      out.push({ heading, nums: v ? parseSemver(/** @type {string} */ (v[1])) : null, lines: [] });
    } else if (out.length) /** @type {{ lines: string[] }} */ (out[out.length - 1]).lines.push(line);
  }
  return out;
}

/**
 * The entries (one string each, bullets joined with their continuation lines) of the releases newer than
 * `current` up to and including `target`, newest first. Empty when no heading matches.
 * @param {string} text the CHANGELOG.md of the target
 * @param {number[]} current @param {number[]} target
 */
export function changesBetween(text, current, target) {
  /** @type {string[]} */
  const entries = [];
  const sections = parseChangelog(text)
    .filter((s) => s.nums && cmp(s.nums, current) > 0 && cmp(s.nums, target) <= 0)
    .sort((a, b) => cmp(/** @type {number[]} */ (b.nums), /** @type {number[]} */ (a.nums)));
  for (const s of sections) {
    /** @type {string[] | null} */
    let cur = null;
    for (const raw of s.lines) {
      if (/^\s*[-*]\s+/.test(raw)) {
        cur = [raw.replace(/^\s*[-*]\s+/, "").trim()];
        entries.push("");
        entries[entries.length - 1] = cur[0] ?? "";
      } else if (raw.trim() && cur && /^\s/.test(raw)) {
        entries[entries.length - 1] += " " + raw.trim();
      } else if (raw.trim() && !/^#/.test(raw)) {
        cur = null;
        entries.push(raw.trim());
      } else if (!raw.trim()) cur = null;
    }
  }
  return entries;
}

/** The first n lines of the top "## " section of a changelog. @param {string} text @param {number} n */
export function topSection(text, n = 20) {
  const s = parseChangelog(text)[0];
  return s ? [s.heading, ...s.lines.filter((l) => l.trim())].slice(0, n) : [];
}

/** Text wrapped at a width, the first line behind a bullet, the rest indented. @param {string} text @param {string} bullet @param {number} [width] */
export function wrap(text, bullet, width = 76) {
  const indent = " ".repeat(bullet.length);
  /** @type {string[]} */
  const lines = [];
  let line = bullet;
  for (const word of clean(text).split(/\s+/).filter(Boolean)) {
    if (line.length + word.length + 1 > width && line.trim().length > bullet.trim().length) {
      lines.push(line);
      line = indent + word;
    } else line += (line === bullet || line === indent ? "" : " ") + word;
  }
  lines.push(line);
  return lines;
}

/**
 * The kit ui components and client modules an app imports, with the number of files that import each:
 * "@gas-kit/ui/components/quad.js" and "@gas-kit/client/dom.js" (or a relative path into src/kit) give quad and dom.
 * Reads src/ of the app except src/kit; symbolic links and big files are skipped.
 * @param {string} root the app root
 * @returns {Map<string, number>}
 */
export function appUsage(root) {
  /** @type {Map<string, Set<string>>} */
  const files = new Map();
  const src = join(root, "src");
  /** @type {string[]} */
  let rels = [];
  try {
    rels = walkFiles(src, { links: [] });
  } catch {
    // An unreadable folder only costs the "your app uses" notes.
  }
  for (const rel of rels) {
    if (rel.startsWith("kit/") || !/\.(?:m?js|jsx|ts|tsx)$/.test(rel)) continue;
    let text;
    try {
      const st = lstatSync(join(src, rel));
      if (!st.isFile() || st.size > MAX_TEXT) continue;
      text = readFileSync(join(src, rel), "utf8");
    } catch {
      continue;
    }
    for (const spec of importSpecifiers(text)) {
      const m = /^@gas-kit\/(?:ui|client)\/(?:.+\/)?([\w-]+)\.js$/.exec(spec) ?? /(?:^|\/)kit\/(?:ui|client)\/src\/(?:.+\/)?([\w-]+)\.js$/.exec(spec);
      if (!m) continue;
      const name = /** @type {string} */ (m[1]);
      if (!files.has(name)) files.set(name, new Set());
      /** @type {Set<string>} */ (files.get(name)).add(rel);
    }
  }
  return new Map([...files].map(([k, v]) => [k, v.size]));
}

/**
 * The "Your app uses <name> in N files." lines for a changelog entry that names a module the app imports.
 * @param {string} entry @param {Map<string, number>} usage
 */
export function usageNotes(entry, usage) {
  /** @type {string[]} */
  const notes = [];
  for (const [name, n] of [...usage].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))) {
    if (name.length < 3 || !new RegExp("(?<![\\w-])" + name.replace(/[^\w-]/g, "") + "(?![\\w-])", "i").test(entry)) continue;
    notes.push("Your app uses " + name + " in " + n + (n === 1 ? " file." : " files."));
    if (notes.length === 3) break;
  }
  return notes;
}

/** "19 Nov 2026" (UTC) from epoch seconds. @param {number} secs */
export function formatDate(secs) {
  const d = new Date(secs * 1000);
  return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
}

/**
 * True when every part of rel under dir exists and is a real folder or file (no link on the way), false when a
 * part is absent. Throws when a part is a link or the real path leaves dir: the remote chose that layout.
 * @param {string} dir @param {string} rel
 */
function realUnder(dir, rel) {
  const base = realpathSync(dir);
  let cur = dir;
  for (const part of rel.split("/")) {
    cur = join(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return false;
    }
    if (st.isSymbolicLink()) throw new Error("a link in the kit's template path");
  }
  const real = realpathSync(cur);
  if (real !== base && !real.startsWith(base + sep)) throw new Error("the template path leaves the kit");
  return true;
}

/**
 * Files of the template-derived paths of a kit checkout, as relative path to sha256. Links and big files are
 * skipped; a link in a template folder path throws (the caller reports "could not compare").
 * @param {string} dir
 */
function templateHashes(dir) {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} rel */
  const add = (rel) => {
    if (!realUnder(dir, rel)) return;
    const st = lstatSync(join(dir, rel));
    if (st.isFile() && st.size <= MAX_TEXT) out[rel] = sha256(readFileSync(join(dir, rel)));
  };
  for (const p of TEMPLATE_PATHS) {
    if (p.endsWith("/tools")) {
      if (realUnder(dir, p)) for (const f of walkFiles(join(dir, p), { links: [] })) add(p + "/" + f);
    } else add(p);
  }
  return out;
}

/**
 * Template-derived files that differ between two kit checkouts (added, changed or removed).
 * @param {string} from @param {string} to
 */
export function templateChanges(from, to) {
  const s = summarize(templateHashes(from), templateHashes(to));
  return [...s.added, ...s.changed, ...s.removed].sort().map((f) => f.replace(/^templates\/register\//, ""));
}

/**
 * @typedef {object} UpdateOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {{ plain?: boolean, noColor?: boolean }} [globals]
 * @property {any} [input] @property {any} [output]
 * @property {(root: string) => Promise<{ code: number | null, tail: string[] }>} [check] runs npm run check (tests)
 * @property {(root: string, source?: { url: string, label: string }) => ReturnType<typeof verifyUpstream>} [upstream] the upstream check (tests)
 * @property {(lines: string[]) => void} [say] where the report goes when there is no terminal (main passes out: lines appear as they happen, also when a step fails)
 * @property {(ctx: { commit: string }) => void} [afterShown] called after the target is shown and before it is applied (tests: move a tag)
 */

/** Run `npm run check` with no shell and capture the tail of its output. @param {string} root */
function npmCheck(root) {
  return new Promise((done) => {
    /** @type {string[]} */
    const lines = [];
    try {
      const run = npmInvocation("npm", ["run", "check"]);
      const child = nodeSpawn(run.cmd, run.args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false });
      const keep = (/** @type {Buffer} */ b) => void lines.push(...String(b).split("\n"));
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      child.on("error", () => done({ code: null, tail: [] }));
      child.on("close", (code) => done({ code, tail: lines.filter((l) => l.trim()).slice(-15) }));
    } catch {
      done({ code: null, tail: [] });
    }
  });
}

/** The tags of a remote, newest first. @param {string} url @param {string} label */
function listTags(url, label) {
  const allowFile = assertFetchable(url, label);
  const scratch = mkdtempSync(join(tmpdir(), "gas-kit-update-"));
  try {
    const out = runGit(["ls-remote", "--tags", "--", url], { cwd: scratch, allowFile, timeout: NETWORK_TIMEOUT_MS });
    return parseTags(out);
  } catch (e) {
    const err = /** @type {Error & { stderr?: string }} */ (e);
    throw new FriendlyError({
      title: "Could not read the kit's releases",
      why: "gas-kit could not ask " + printable(url) + " for its release tags.",
      fix: "Check your internet connection and that you can reach it, then run npm run kit -- update again.",
      detail: printable(String(err.stderr ?? err.message).trim().split("\n")[0] ?? ""),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The guard lists a release loosens, as plain lines. A comparison that fails is reported as unknown, never as fine. @param {string} root @param {string} releaseDir */
function looserGuards(root, releaseDir) {
  try {
    return describeGuardChanges(guardChanges(join(root, KIT_DIR), releaseDir));
  } catch {
    return ["the guard lists could not be compared"];
  }
}

/** Epoch seconds of a commit in a fetched checkout, or null. @param {string} dir @param {string} commit */
function commitTime(dir, commit) {
  try {
    const n = Number(gitIn(dir)(["log", "-1", "--format=%ct", commit]).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * The date a changelog heading carries ("0.2.0 (2026-11-19)", "v0.2.0 - 19 Nov 2026"), as "19 Nov 2026", or "".
 * Only digits and a known month name are read, so nothing else of the heading is passed on.
 * @param {string} heading
 */
export function headingDate(heading) {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(heading);
  if (iso) {
    const mon = MONTHS[Number(iso[2]) - 1];
    return mon && Number(iso[3]) >= 1 && Number(iso[3]) <= 31 ? Number(iso[3]) + " " + mon + " " + iso[1] : "";
  }
  const words = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/.exec(heading);
  return words ? Number(words[1]) + " " + words[2] + " " + words[3] : "";
}

/**
 * Release dates for the version list: the dates in the CHANGELOG.md headings of the newest release, and that
 * release's own commit date. Best effort: any failure gives fewer dates, never an error.
 * @param {string} url @param {string} label @param {Array<{ version: string, commit: string, nums: number[] }>} tags newest first
 * @returns {Map<string, string>}
 */
function releaseDates(url, label, tags) {
  /** @type {Map<string, string>} */
  const dates = new Map();
  const newest = tags[0];
  if (!newest || !isFullCommit(newest.commit)) return dates;
  /** @type {ReturnType<typeof resolveSource> | null} */
  let src = null;
  try {
    src = resolveSource(url + "#" + newest.commit, { label });
    for (const sec of parseChangelog(readChangelog(src.dir))) {
      const d = headingDate(sec.heading);
      if (sec.nums && d) dates.set(sec.nums.join("."), d);
    }
    const when = commitTime(src.dir, newest.commit);
    if (when && !dates.has(newest.version)) dates.set(newest.version, formatDate(when));
  } catch {
    // no dates: the list is shown without them
  } finally {
    src?.cleanup();
  }
  return dates;
}

/** The text of CHANGELOG.md in a fetched kit when it is a regular file, else "". @param {string} dir */
function readChangelog(dir) {
  try {
    const p = join(dir, "CHANGELOG.md");
    const st = lstatSync(p);
    return st.isFile() && st.size <= MAX_TEXT ? readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

/** True when `git status` of the app shows src/kit or kit.lock.json clean. Throws a FriendlyError when it is not, or git cannot tell. @param {string} root */
function assertCleanTree(root) {
  let status;
  try {
    status = runGit(["status", "--porcelain", "--untracked-files=all", "--", KIT_DIR, LOCK_FILE], { cwd: root });
  } catch {
    throw new FriendlyError({
      title: "Can't update: this folder is not a git repository",
      why: "An update replaces src/kit, and without git there is no way to undo it.",
      fix: ["git init", "git add -A && git commit -m \"before the kit update\"", "then run npm run kit -- update again"],
    });
  }
  if (status.trim()) {
    throw new FriendlyError({
      title: "Can't update: you have unsaved changes in the kit files",
      why: "An update replaces src/kit and kit.lock.json, so changes there would be lost.",
      fix: "Commit or undo them first (git status shows which), then run npm run kit -- update again.",
      more: status.trim().split("\n").slice(0, 10).map((l) => printable(l)),
    });
  }
}

/**
 * @param {{ positional: string[], flags: Record<string, string | boolean> }} parsed
 * @param {UpdateOptions} [opts]
 * @returns {Promise<{ lines: string[], code: number }>} lines for main's out() (empty after an interactive session)
 */
export async function runUpdate(parsed, opts = {}) {
  const env = opts.env ?? process.env;
  const rootFlag = parsed.flags["root"];
  if (rootFlag === "") throw new UsageError("--root needs a folder", { title: "--root needs a folder", why: "The flag was given with nothing after it.", fix: "Write --root <your app's folder>, or leave it out to use this folder.", more: "npm run kit -- help" });
  const root = resolve(typeof rootFlag === "string" ? rootFlag : ".");
  const lock = readLock(root);
  if (!existsSync(join(root, "package.json")) || !lock) {
    throw new FriendlyError({
      title: "Can't update: this is not an app made with gas-kit",
      why: "There is no kit.lock.json here, so gas-kit does not know which kit version you have.",
      fix: "Run it inside your app's folder, or pass --root <app dir>.",
      detail: root + " has no readable " + LOCK_FILE,
    });
  }
  const toFlag = typeof parsed.flags["to"] === "string" ? parsed.flags["to"] : null;
  const toNums = toFlag === null ? null : parseSemver(toFlag.trim());
  if (toFlag !== null && !toNums) throw new UsageError("--to needs a release number such as 0.2.0 or v0.2.0", { title: "--to needs a version number", why: "A release is named like 0.2.0 or v0.2.0.", fix: "npm run kit -- update --to 0.2.0", more: "npm run kit -- help version" });
  const uiOpts = { input: opts.input, output: opts.output, env, flags: { ...parsed.flags, plain: opts.globals?.plain === true, "no-color": opts.globals?.noColor === true } };
  const talk = ui.isInteractive(uiOpts) && toNums === null;
  const live = ui.isInteractive(uiOpts);
  /** @type {string[]} */
  const lines = [];
  /** @param {string[]} ls */
  const say = (ls) => (live ? ui.print(ls, uiOpts) : opts.say ? opts.say(ls) : void lines.push(...ls));

  const want = resolveFrom(Object.fromEntries(Object.entries(parsed.flags).filter(([k]) => k !== "ref")), lock, env);
  if (!isGitUrl(want.from)) {
    throw new FriendlyError({
      title: "Can't update from a folder",
      why: "Release versions come from the tags of a kit repository, and " + printable(want.from) + " is a folder on this computer.",
      fix: "npm run kit -- update --from <git URL>   (or npm run kit:sync -- --from <folder> to take that folder as it is)",
    });
  }
  const url = splitSource(want.from).url;
  const current = parseSemver(String(lock.kit?.version ?? ""));
  const tags = listTags(url, want.via);
  if (!tags.length) {
    throw new FriendlyError({
      title: "This kit has no releases yet",
      why: "There is no version tag (such as v0.2.0) on " + printable(url) + ", so there is nothing to choose from.",
      fix: "ask the kit maintainer to tag a release, or npm run kit:sync -- --ref <commit>",
    });
  }
  const newer = current ? tags.filter((t) => cmp(t.nums, current) > 0) : tags;
  const fromHint = want.via === "--from" ? " --from " + printable(want.from) : "";
  const mine = printable(lock.kit?.version ?? "unknown");
  say(["", "  You have kit " + mine + (current ? "" : " (not a release number, so every release is listed)") + (newer.length ? ". Newer versions on " + printable(url) + ":" : ".")]);
  /** @type {(typeof tags)[number] | null} */
  let pick = toNums === null ? null : (tags.find((t) => cmp(t.nums, toNums) === 0) ?? null);
  if (toNums !== null) {
    if (!pick) {
      throw new FriendlyError({
        title: "There is no release " + printable(toFlag) + " to update to",
        why: printable(url) + (newer.length ? " has these newer releases: " + newer.map((t) => t.version).join(", ") + "." : " has no newer release than your kit " + mine + "."),
        fix: newer.length ? "npm run kit -- update --to " + newer[0]?.version + fromHint : "Check the version you typed, or run npm run kit -- update to see the releases.",
      });
    }
    if (current && (cmp(pick.nums, current) < 0 || (cmp(pick.nums, current) === 0 && newer.length))) {
      throw new FriendlyError({
        title: "Release " + pick.version + " is not newer than your kit " + mine,
        why: "update only moves forward.",
        fix: "npm run kit:sync -- --ref " + pick.name + fromHint + "   (to go back on purpose)",
      });
    }
  }
  if (!newer.length) {
    say(["  Your kit is up to date: " + printable(url) + " has no newer release.", ""]);
    return { lines, code: 0 };
  }
  const dates = toNums === null ? releaseDates(url, want.via, newer) : new Map();
  if (!talk && toNums === null) {
    say([...newer.map((t, i) => "    " + t.version + (dates.get(t.version) ? "   " + dates.get(t.version) : "") + (i === 0 ? "   latest" : "")), "", "  Nothing was changed. To update, run: npm run kit -- update --to " + newer[0]?.version + fromHint]);
    return { lines, code: 0 };
  }

  if (toNums === null) {
    const version = await ui.select({
      ...uiOpts,
      message: "Which version?",
      choices: newer.map((t, i) => {
        const hint = [dates.get(t.version), i === 0 ? "latest" : ""].filter(Boolean).join("   ");
        return { value: t.version, label: t.version, ...(hint ? { hint } : {}) };
      }),
      initial: newer[0]?.version,
    });
    pick = newer.find((t) => t.version === version) ?? null;
  }
  const target = /** @type {NonNullable<typeof pick>} */ (pick);
  const commit = target.commit;
  if (!isFullCommit(commit)) throw new FriendlyError({ title: "Can't update: the release tag does not name a commit", why: "A release has to point at one exact version of the kit, and this one does not.", fix: "Ask the kit maintainer to tag the release again.", more: "npm run kit -- help version" });

  // Fetch exactly the commit the tag named: a commit id is only taken when a branch or tag of the remote holds it.
  const src = resolveSource(url + "#" + commit, { label: want.via });
  /** @type {ReturnType<typeof resolveSource> | null} */
  let old = null;
  try {
    const when = commitTime(src.dir, commit);
    /** @type {string[]} */
    const report = ["", "  Version " + target.version + (when ? ", released " + formatDate(when) : "") + ", commit " + commit.slice(0, 12) + "."];
    if (src.version !== target.version) report.push("  ! The tag says " + target.version + " but the kit inside says " + printable(src.version) + ".");
    report.push("", "  What changes for you in " + target.version);
    const text = readChangelog(src.dir);
    const entries = current ? changesBetween(text, current, target.nums) : [];
    const usage = appUsage(root);
    if (entries.length) {
      for (const e of entries.slice(0, 25)) {
        report.push(...wrap(e, "   • "));
        for (const n of usageNotes(e, usage)) report.push("     " + clean(n));
      }
      if (entries.length > 25) report.push("   …and " + (entries.length - 25) + " more in CHANGELOG.md");
    } else {
      const top = topSection(text, 20);
      report.push("   The changelog has no entry for " + (current ? "versions after " + mine + " up to " + target.version : target.version) + (top.length ? ". Its top section:" : " and none at all."));
      for (const l of top) report.push("     " + clean(l.length > 100 ? l.slice(0, 100) + "…" : l));
    }
    // The old version, for the template comparison: it may be gone from the remote, which only costs the list.
    /** @type {string[] | null} */
    let tmpl = null;
    if (isFullCommit(lock.kit?.commit)) {
      try {
        old = resolveSource(url + "#" + String(lock.kit.commit).toLowerCase(), { label: want.via });
        tmpl = templateChanges(old.dir, src.dir);
      } catch {
        tmpl = null;
      }
    }
    if (tmpl && tmpl.length) {
      report.push("", "  Review these in your app (upgrade-kit skill)");
      for (const f of tmpl.slice(0, 30)) report.push("   • " + clean(f));
    } else if (!tmpl) report.push("", "  (Could not compare the template files with your current kit; the upgrade-kit skill lists them.)");
    else report.push("", "  Your own files don't need changes.");
    // The guard lists the app runs live in src/kit: a release that makes them looser is never applied unseen.
    const looser = looserGuards(root, src.dir);
    const accepted = parsed.flags["accept-looser"] === true;
    if (looser.length) {
      report.push("", "  ! This release makes the checks that guard your app looser");
      for (const l of looser.slice(0, 20)) report.push(...wrap(l, "   • "));
      report.push("    Read what the kit now allows (the upgrade-kit skill says how) before you accept it.");
    }
    say(report);
    if (looser.length && !accepted) {
      if (!talk) {
        throw new FriendlyError({
          title: "Not updated: this release makes the kit's checks looser",
          why: "A guard list in the new kit allows more than the one you have, so npm run check would pass against a weaker guard.",
          fix: ["Read the lines above and the upgrade-kit skill, then if you accept them run", "npm run kit -- update --to " + target.version + " --accept-looser" + (want.via === "--from" ? " --from " + printable(want.from) : "")],
          more: looser.slice(0, 10),
          exitCode: 1,
        });
      }
      if (!(await ui.confirm({ ...uiOpts, message: "This release loosens the kit's checks. Have you read what changes, and want to update anyway?", initial: false }))) {
        ui.outro("Nothing was changed.", uiOpts);
        return { lines: [], code: 0 };
      }
    }

    /** Every file the update would add, change or remove in src/kit. */
    const changedFiles = () => {
      const kitRoot = join(root, KIT_DIR);
      const before = hashFiles(Object.fromEntries(walkFiles(kitRoot, { links: [] }).map((f) => [f, join(kitRoot, f)])));
      const sum = summarize(before, hashFiles(vendorFiles(src.dir)));
      return [...sum.added.map((f) => "  + " + f), ...sum.changed.map((f) => "  ~ " + f), ...sum.removed.map((f) => "  - " + f)];
    };
    if (talk) {
      let go = await ui.select({ ...uiOpts, message: "Update now?", choices: [{ value: "yes", label: "Yes" }, { value: "show", label: "Show every changed file first" }, { value: "no", label: "Not now" }], initial: "yes" });
      if (go === "show") {
        ui.print(["", ...changedFiles(), ""], uiOpts);
        go = (await ui.confirm({ ...uiOpts, message: "Update now?", initial: true })) ? "yes" : "no";
      }
      if (go !== "yes") {
        ui.print(["  To update later: npm run kit -- update --to " + target.version + fromHint], uiOpts);
        ui.outro("Nothing was changed.", uiOpts);
        return { lines: [], code: 0 };
      }
    }
    opts.afterShown?.({ commit });
    return await apply({ talk, accept: accepted || looser.length > 0, root, commit, target, want, lock, uiOpts, live, say, lines, opts, env, parsed });
  } finally {
    src.cleanup();
    old?.cleanup();
  }
}

/**
 * Apply the update shown: clean tree, sync pinned to the commit, upstream check, npm run check.
 * @param {{ talk: boolean, accept: boolean, root: string, commit: string, target: { version: string }, want: ReturnType<typeof resolveFrom>, lock: any, uiOpts: any, live: boolean, say: (l: string[]) => void, lines: string[], opts: UpdateOptions, env: Record<string, string | undefined>, parsed: { flags: Record<string, string | boolean> } }} c
 * @returns {Promise<{ lines: string[], code: number }>}
 */
async function apply(c) {
  const { root, commit, target, uiOpts, live, opts } = c;
  assertCleanTree(root);
  let replaced = 0;
  /** @type {{ title: string, run: () => unknown | Promise<unknown>, doneTitle?: (r: any) => string }[]} */
  const tasks = [
    {
      title: "Downloading " + target.version + " and checking it against the release tag",
      doneTitle: () => "Downloaded " + target.version + " and checked it against the release tag",
      run: () => {
        // Pinned to the full commit shown above: a tag that moved since cannot change what is applied.
        // The source is the URL only: the ref is the commit, and a #ref of --from or GAS_KIT is not given twice.
        const url = splitSource(c.want.from).url;
        const flags = { root, ref: commit, ...(c.want.via === "--from" ? { from: url } : {}) };
        const res = runSync({ flags }, c.want.via === "GAS_KIT" ? { ...c.env, GAS_KIT: url } : c.env);
        if (res.code) throw new FriendlyError({ title: "The update was refused", why: res.lines.map((l) => printable(l)).join(" "), fix: "Nothing was changed. See npm run kit:sync for details.", exitCode: 1 });
        const remembered = res.lines.filter((l) => /^Kit source remembered/.test(l));
        if (remembered.length) c.say(remembered.map((l) => "  " + printable(l)));
        const m = res.lines.map((l) => /^(\d+) added, (\d+) changed, (\d+) removed/.exec(l)).find(Boolean);
        replaced = m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0;
        const had = readLock(root)?.kit?.commit;
        if (String(had).toLowerCase() !== commit) {
          throw new FriendlyError({
            title: "The kit that was written is not the release shown",
            why: "kit.lock.json names " + printable(String(had)) + " instead of " + commit + ".",
            fix: undoFix(),
            exitCode: 1,
          });
        }
      },
    },
    {
      title: "Checking the new kit files against the release",
      doneTitle: () => "Replaced " + replaced + " kit files, and they match the release",
      run: () => {
        const up = (opts.upstream ?? verifyUpstream)(root, { url: splitSource(c.want.from).url, label: c.want.via });
        if (up.problems.length) throw new FriendlyError({ title: "The kit files do not match the release", why: "After the update, src/kit is not exactly what the release holds.", more: [...formatProblems(up.problems).map((l) => l.trim()), "npm run kit -- help update"], fix: undoFix(), exitCode: 1 });
      },
    },
    {
      title: "Running npm run check on your app",
      doneTitle: () => "Your app still passes all checks",
      run: async () => {
        const r = await (opts.check ?? npmCheck)(root);
        if (r.code !== 0) {
          throw new FriendlyError({
            title: "Your app does not pass its checks with kit " + target.version,
            why: r.code === null ? "npm run check could not be started." : "npm run check failed.",
            fix: ["Run npm run check to see what to fix, or undo the update:", ...undoFix()],
            more: r.tail.map((/** @type {string} */ l) => printable(l)),
            exitCode: 1,
          });
        }
      },
    },
  ];
  /** @returns {string[]} */
  function undoFix() {
    return ["git checkout -- src/kit kit.lock.json", "(and git clean -fd src/kit if the update added files)"];
  }
  if (live) {
    await ui.steps(tasks, uiOpts);
    if (c.talk) ui.print(["  The same in one line: npm run kit -- update --to " + target.version + (c.want.via === "--from" ? " --from " + printable(c.want.from) : "") + (c.accept ? " --accept-looser" : "")], uiOpts);
    ui.outro("Updated to " + target.version + ". Nothing is committed yet; undo with git checkout -- src/kit kit.lock.json (and git clean -fd src/kit if files were added)", uiOpts);
    return { lines: [], code: 0 };
  }
  for (const t of tasks) {
    const r = await t.run();
    c.say(["✔ " + (t.doneTitle ? t.doneTitle(r) : t.title)]);
  }
  c.say(["Updated to " + target.version + ". Nothing is committed yet; undo with git checkout -- src/kit kit.lock.json (and git clean -fd src/kit if files were added)"]);
  return { lines: c.lines, code: 0 };
}

/**
 * The newer releases of the kit remote an app remembers, for the control panel (no prompt, nothing written). The
 * same rules as runUpdate: a git URL only (https or ssh), release tags only, newest first.
 * @param {string} root the app folder
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ current: string, url: string, via: string, newer: Array<{ version: string, commit: string, name: string, nums: number[] }> }}
 */
export function listUpdates(root, env = process.env) {
  const lock = readLock(root);
  if (!existsSync(join(root, "package.json")) || !lock) {
    throw new FriendlyError({ title: "Can't update: this is not an app made with gas-kit", why: "There is no kit.lock.json here, so gas-kit does not know which kit version you have.", fix: "Open the panel from your app's folder." });
  }
  const want = resolveFrom({}, lock, env);
  if (!isGitUrl(want.from)) {
    throw new FriendlyError({ title: "Can't update from a folder", why: "Release versions come from the tags of a kit repository, and " + printable(want.from) + " is a folder on this computer.", fix: "npm run kit -- update --from <git URL>" });
  }
  const url = splitSource(want.from).url;
  const current = parseSemver(String(lock.kit?.version ?? ""));
  const tags = listTags(url, want.via);
  const newer = current ? tags.filter((t) => cmp(t.nums, current) > 0) : tags;
  return { current: printable(lock.kit?.version ?? "unknown"), url, via: want.via, newer };
}

/**
 * What one listed release changes for the app: the changelog entries and the template files to review. The version
 * must be one of listUpdates' newer releases (anything else is refused before a fetch).
 * @param {string} root @param {Record<string, string | undefined>} env @param {string} version
 * @returns {{ version: string, commit: string, released: string, changes: string[], review: string[] | null, looser: string[] }}
 */
export function describeUpdate(root, env, version) {
  const info = listUpdates(root, env);
  const target = info.newer.find((t) => t.version === version);
  if (!target) throw new FriendlyError({ title: "There is no newer release " + printable(version), why: "Only the releases listed by the kit remote can be chosen.", fix: "Choose one from the list." });
  if (!isFullCommit(target.commit)) throw new FriendlyError({ title: "The release tag does not name a commit", why: "A release has to point at one exact version of the kit, and this one does not.", fix: "Ask the kit maintainer to tag the release again.", more: "npm run kit -- help version" });
  const lock = readLock(root);
  const src = resolveSource(info.url + "#" + target.commit, { label: info.via });
  /** @type {ReturnType<typeof resolveSource> | null} */
  let old = null;
  try {
    const when = commitTime(src.dir, target.commit);
    const current = parseSemver(String(lock?.kit?.version ?? ""));
    const entries = current ? changesBetween(readChangelog(src.dir), current, target.nums) : [];
    const usage = appUsage(root);
    const changes = entries.slice(0, 25).flatMap((e) => [clean(e), ...usageNotes(e, usage).map((n) => "  " + clean(n))]);
    /** @type {string[] | null} */
    let review = null;
    if (lock && isFullCommit(lock.kit?.commit)) {
      try {
        old = resolveSource(info.url + "#" + String(lock.kit.commit).toLowerCase(), { label: info.via });
        review = templateChanges(old.dir, src.dir).slice(0, 30).map((f) => clean(f));
      } catch {
        review = null;
      }
    }
    return { version: target.version, commit: target.commit, released: when ? formatDate(when) : "", changes, review, looser: looserGuards(root, src.dir).map((l) => clean(l)) };
  } finally {
    src.cleanup();
    old?.cleanup();
  }
}
