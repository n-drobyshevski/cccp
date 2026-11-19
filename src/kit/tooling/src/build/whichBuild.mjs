// Extracted from the author's production Apps Script apps; adapted.
//
// Resolve a build id to the commits that produced it.
//
//   npm run which-build           the id currently baked into dist/
//   npm run which-build <id>      an id read off a deployment (diagnostics)
//   npm run which-build -- --local   print the stamp of the working tree and exit
//
// The bundle carries __BUILD_ID__, a content hash (see stamp.mjs). This replays that hash across
// history. The answer is a range: any commit that leaves the stamp inputs byte-identical
// produces the same build. Each candidate is materialised with `git archive` and hashed by
// sourceStamp itself, never re-derived from tree objects, so it cannot disagree with the build.
// The archive goes to a file, not through a pipe, and is made at the repo root so
// .gitattributes (eol=lf) applies.

import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAMP_EXTRA_FILES, sourceStamp } from "./stamp.mjs";

/** The line a dev build carries after its banner: deploy and distId refuse a bundle with it. */
export const DEV_MARKER = "/* gas-kit dev build: never push or deploy */";

/** True when dist/server.js under here is a dev build (it carries DEV_MARKER). @param {string} here */
export function isDevBundle(here) {
  const f = join(here, "dist/server.js");
  return existsSync(f) && readFileSync(f, "utf8").slice(0, 512).includes(DEV_MARKER);
}

/** The build id baked into dist/server.js (the banner marker defineBuild writes), or null, also
 *  for a dev build (one that carries DEV_MARKER), which no deployment may be labelled with. */
export function distId(/** @type {string} */ here) {
  const f = join(here, "dist/server.js");
  if (!existsSync(f)) return null;
  const text = readFileSync(f, "utf8");
  if (text.slice(0, 512).includes(DEV_MARKER)) return null;
  const m = /^\/\* build ([0-9a-f]{6,}) \*\//.exec(text);
  return m ? m[1] : null;
}

/**
 * @param {string} here app root (inside a git checkout)
 * @param {string[]} [argv] process-style argv (id at index 2)
 * @param {{ log?: (m: string) => void, error?: (m: string) => void }} [io]
 * @returns {number} exit code
 */
export function whichBuild(here, argv = process.argv, io = {}) {
  const log = io.log ?? ((m) => console.log(m));
  const error = io.error ?? ((m) => console.error(m));
  /** @param {string[]} args @param {string} [cwd] */
  const git = (args, cwd = here) =>
    execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

  if (argv[2] === "--local") {
    log(sourceStamp(here));
    return 0;
  }

  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  const prefix = git(["rev-parse", "--show-prefix"]).trim().replace(/\/$/, "");
  const rel = (/** @type {string} */ p) => (prefix ? prefix + "/" + p : p);

  /** The stamp at `commit`, or null if the app had no src/ there. Pathspecs cover everything
   *  the stamp hashes: src plus the extra files that exist at that commit. */
  function stampAt(/** @type {string} */ commit) {
    const dir = mkdtempSync(join(tmpdir(), "which-build-"));
    const tarFile = join(dir, "archive.tar");
    try {
      const present = git(["ls-tree", "--name-only", commit, "--", ...["src", ...STAMP_EXTRA_FILES].map(rel)], repoRoot)
        .split("\n").filter(Boolean);
      if (!present.includes(rel("src"))) return null;
      execFileSync("git", ["archive", "--format=tar", "-o", tarFile, commit, ...present], {
        cwd: repoRoot, maxBuffer: 1 << 28, stdio: ["ignore", "ignore", "ignore"],
      });
      execFileSync("tar", ["-xf", tarFile, "-C", dir], { stdio: ["ignore", "ignore", "ignore"] });
      const pkgDir = prefix ? join(dir, prefix) : dir;
      return existsSync(join(pkgDir, "src")) ? sourceStamp(pkgDir) : null;
    } catch {
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Preflight: every failure of stampAt looks like "no match", so prove it works on HEAD first.
  if (!stampAt("HEAD")) {
    error("which-build is broken: cannot hash the stamp inputs at HEAD.");
    error("  repo root: " + repoRoot + "\n  app prefix: " + (prefix || "(repo root)"));
    error("Check that `git archive` and `tar` are available and that src/ is tracked.");
    return 2;
  }

  const arg = argv[2];
  const wanted = arg || distId(here);
  if (!wanted) {
    error("No build id given, and none could be read from dist/server.js.\nUsage: npm run which-build [<build-id>]");
    return 2;
  }

  // Only commits that touched a stamp input can move the stamp.
  const commits = git(["log", "--format=%H\t%cI\t%s", "--", ...["src", ...STAMP_EXTRA_FILES].map(rel)], repoRoot)
    .split("\n").filter(Boolean).map((l) => {
      const [sha, date, ...rest] = l.split("\t");
      return { sha, date, subject: rest.join("\t") };
    });

  if (!arg) log("Build id in dist/: " + wanted);
  log("Scanning " + commits.length + " commits that touched the stamp inputs.\n");

  const matches = commits.filter((c) => stampAt(c.sha) === wanted);
  if (!matches.length) {
    log("No commit produces build " + wanted + ".");
    if (sourceStamp(here) === wanted) {
      log("It matches the working tree, so it was built from uncommitted edits.\nCommit them and it will resolve.");
    } else {
      log("The build came from a tree that was never committed here: uncommitted edits, a\nbranch not present locally, or a fork. Try `git fetch --all` and re-run.");
    }
    return 1;
  }

  const short = (/** @type {string} */ s) => s.slice(0, 7);
  const day = (/** @type {string} */ iso) => iso.slice(0, 10);
  log("Build " + wanted + " came from these commits:\n");
  for (const c of matches) log("  " + short(c.sha) + "  " + day(c.date) + "  " + c.subject);

  const newest = matches[0];
  const supersededBy = commits[commits.indexOf(newest) - 1] || null;
  if (supersededBy) {
    log("\nIt is the live build from " + short(newest.sha) + " until " + short(supersededBy.sha) + " (" + day(supersededBy.date) + "), the next commit that changed the stamp inputs.");
  } else {
    log("\nNo later commit has changed the stamp inputs, so this is still the current build.");
  }
  return 0;
}

const real = (/** @type {string} */ p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exit(whichBuild(process.cwd()));
}
