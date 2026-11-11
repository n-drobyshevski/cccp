#!/usr/bin/env node
// Vendoring tool for CCCP.
//
//   node tools/vendor.mjs sync   --from <sidekick repo> --commit <sha>   write the locked set
//   node tools/vendor.mjs verify [--root <dir>]                          sha256 + import check
//   node tools/vendor.mjs diff   --from <sidekick repo> --to <sha>       upstream changes since the pin
//
// Files are read with `git show <commit>:<path>`, never from a working tree, so a dirty
// checkout cannot leak in. src/vendor is VERBATIM ONLY: nothing under it is ever edited.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
export const LOCK_REL = "tools/vendor.lock.json";
export const VENDOR_DIR = "src/vendor";
export const DEFAULT_COMMIT = "77bcf22";

/** The verbatim set: sidekick path -> same path under src/vendor. */
export const VENDOR_SET = [
  "gas_shared/ui/settingsForm.js",
  "gas_shared/ui/tableModel.js",
  "gas_shared/ui/timing.js",
  "gas_shared/ui/tipPlace.js",
  "gas_shared/ui/accessSave.js",
  "gas_hub/src/client/js/pages/accessModel.js",
  "gas_shared/domain/csv.ts",
  "gas_shared/domain/sha1.ts",
  "gas_shared/domain/snapshotCodec.ts",
  "gas_shared/server/inlineBoot.ts",
  "gas_shared/server/errorLog.ts",
  "gas_shared/server/buildInfo.ts",
  "gas_shared/build/buildStamp.mjs",
  "gas_shared/build/deploy.mjs",
  "gas_shared/test/contracts/settingsForm.js",
  "gas_shared/test/contracts/accessSave.js",
];

const toPath = (from) => `${VENDOR_DIR}/${from}`;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function readLock(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, LOCK_REL), "utf8"));
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

const EXT_CANDIDATES = ["", ".js", ".ts", ".mjs", "/index.js", "/index.ts"];
const BUILTINS = new Set(builtinModules);

/** Drops block comments and whole-line `//` comments (they cannot import). Trailing comments stay: conservative. */
function stripWholeComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every module specifier a source text imports. */
export function importSpecifiers(source) {
  const text = stripWholeComments(source);
  const out = new Set();
  const patterns = [
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /(?:^|[^\w$.])import\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.add(m[2]);
  // A dynamic import with a non-literal argument cannot be resolved: flag it.
  for (const m of text.matchAll(/\bimport\s*\(\s*(?!['"\s])/g)) out.add(`<dynamic:${m[0]}>`);
  return [...out];
}

/**
 * Problems for one vendored file: any specifier that is not a node builtin and does not
 * resolve (relatively) to another file of the vendored set. `known` holds repo-relative
 * destination paths.
 */
export function importProblems(destPath, text, known) {
  const problems = [];
  for (const spec of importSpecifiers(text)) {
    if (spec.startsWith("node:") || BUILTINS.has(spec)) continue;
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const base = posix.normalize(posix.join(posix.dirname(destPath), spec));
      if (EXT_CANDIDATES.some((e) => known.has(base + e))) continue;
      problems.push(`${destPath}: imports "${spec}" which resolves outside the vendored set (${base})`);
      continue;
    }
    problems.push(`${destPath}: imports "${spec}" which is not a node builtin or a vendored file`);
  }
  return problems;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Returns a list of problem sentences; empty means the vendored tree is exactly the lock. */
export function verify(root = REPO_ROOT) {
  const problems = [];
  let lock;
  try {
    lock = readLock(root);
  } catch (e) {
    return [`cannot read ${LOCK_REL}: ${e.message}`];
  }
  const locked = new Map(lock.files.map((f) => [f.to, f]));
  const wantTo = new Set(VENDOR_SET.map(toPath));
  for (const t of wantTo) if (!locked.has(t)) problems.push(`lock is missing ${t}`);
  for (const t of locked.keys()) if (!wantTo.has(t)) problems.push(`lock lists ${t}, which is not in VENDOR_SET`);
  const known = new Set(locked.keys());
  for (const f of lock.files) {
    const abs = join(root, f.to);
    if (!existsSync(abs)) {
      problems.push(`missing vendored file ${f.to}`);
      continue;
    }
    const buf = readFileSync(abs);
    const got = sha256(buf);
    if (got !== f.sha256) problems.push(`${f.to}: sha256 ${got.slice(0, 12)} does not match lock ${f.sha256.slice(0, 12)}`);
    problems.push(...importProblems(f.to, buf.toString("utf8"), known));
  }
  const vdir = join(root, VENDOR_DIR);
  for (const abs of walk(vdir)) {
    const rel = relative(root, abs).split(sep).join("/");
    if (!locked.has(rel)) problems.push(`unlocked file under ${VENDOR_DIR}: ${rel}`);
  }
  return problems;
}

/** Writes exactly the vendored set from `<repo>@<commit>` and rewrites the lock. */
export function sync({ from, commit, root = REPO_ROOT }) {
  if (!from || !commit) throw new Error("sync needs --from <repo> and --commit <sha>");
  const full = git(from, ["rev-parse", "--verify", `${commit}^{commit}`]).toString().trim();
  const fetched = VENDOR_SET.map((src) => {
    const spec = `${full}:${src}`;
    const buf = git(from, ["show", spec]);
    const mode = git(from, ["ls-tree", full, "--", src]).toString().split(" ")[0] || "100644";
    return { from: src, to: toPath(src), buf, mode };
  });
  const known = new Set(fetched.map((f) => f.to));
  const problems = fetched.flatMap((f) => importProblems(f.to, f.buf.toString("utf8"), known));
  if (problems.length) {
    const err = new Error(`refusing to vendor, imports escape the vendored set:\n  ${problems.join("\n  ")}`);
    err.problems = problems;
    throw err;
  }
  // Remove stale vendored files, then write the set.
  for (const abs of walk(join(root, VENDOR_DIR))) {
    const rel = relative(root, abs).split(sep).join("/");
    if (!known.has(rel)) {
      execFileSync("rm", ["-f", abs]);
    }
  }
  for (const f of fetched) {
    const abs = join(root, f.to);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.buf);
  }
  const lock = {
    commit: full.slice(0, 7),
    fullCommit: full,
    files: fetched.map((f) => ({ from: f.from, to: f.to, sha256: sha256(f.buf), mode: f.mode })),
  };
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(join(root, LOCK_REL), JSON.stringify(lock, null, 2) + "\n");
  return lock;
}

/** Upstream changes to the vendored paths between the pin and `to`. */
export function diff({ from, to, root = REPO_ROOT }) {
  if (!from || !to) throw new Error("diff needs --from <repo> and --to <sha>");
  const lock = readLock(root);
  const paths = lock.files.map((f) => f.from);
  const out = git(from, ["diff", `${lock.fullCommit ?? lock.commit}`, to, "--", ...paths]).toString();
  return out;
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const [cmd] = argv;
  const root = arg(argv, "root") ? resolve(arg(argv, "root")) : REPO_ROOT;
  try {
    if (cmd === "sync") {
      const lock = sync({ from: arg(argv, "from"), commit: arg(argv, "commit"), root });
      console.log(`vendored ${lock.files.length} files from ${lock.commit}`);
    } else if (cmd === "verify") {
      const problems = verify(root);
      if (problems.length) {
        console.error(problems.join("\n"));
        console.error(`vendor:verify FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"})`);
        process.exit(1);
      }
      console.log(`vendor:verify ok (${readLock(root).files.length} files @ ${readLock(root).commit})`);
    } else if (cmd === "diff") {
      const text = diff({ from: arg(argv, "from"), to: arg(argv, "to"), root });
      console.log(text || "no upstream changes to the vendored paths");
    } else {
      console.error("usage: vendor.mjs sync --from <repo> --commit <sha> | verify [--root <dir>] | diff --from <repo> --to <sha>");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
