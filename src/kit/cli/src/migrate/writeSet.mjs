// Every write a migration makes into its target goes through a write set. Paths are checked when
// they are added (posix, relative, no "..", no backslash, no NUL, no colon, no drive letter, no
// trailing dot or space, no .git or alias of it). apply then checks every entry against the disk
// before it changes anything: the target is a real directory this user owns that others cannot
// write, no symlink on the way, a real path under the target, no file where a folder must be, a
// writable parent, and (when the write set was given them) no overlap with a source or the kit.
//
// apply changes the target in three phases so a failure leaves it as it was:
//   1. prepare: every write goes to a fresh temporary sibling, and every file a write replaces or
//      a removal deletes is renamed aside to a backup sibling;
//   2. commit: each temporary file is renamed into place, after checking that its folder's real
//      path is still the one validated;
//   3. clean up: the backups are deleted.
// A failure in phase 1 or 2 undoes every step taken so far, in reverse, and throws; if an undo step
// itself fails, the error names exactly what is left where. A failure in phase 3 leaves backups,
// which apply returns as leftovers. A name whose temporary or backup sibling would be over the
// file-name limit (a leaf near 255 bytes) fails in phase 1 and is rolled back.
//
// Residual risk: a process that can write into the target while apply runs can swap a folder for
// a symlink between the checks and a rename. The owner and mode check on the target root keeps
// other users out; the same user's own processes are trusted, as for any tool that writes files.
import { accessSync, constants, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { UsageError } from "../args.mjs";
import { termLine } from "./steps/_common.mjs";
import { realTarget } from "../create.mjs";
import { assertNoLink } from "../vendor.mjs";
import { isDotGit, pathsOverlap } from "./sourceTree.mjs";

/**
 * Why a relative path is unusable as a write-set entry, or null when it is fine.
 * @param {unknown} rel
 * @returns {string | null}
 */
export function relProblem(rel) {
  if (typeof rel !== "string" || rel === "") return "a path must be a non-empty string";
  if (rel.includes("\0")) return "a path may not hold a NUL byte";
  if (/[\u0001-\u001f\u007f]/.test(rel)) return "a path may not hold a control character";
  if (rel.includes("\\")) return "a path is posix: no backslash";
  if (rel.startsWith("/")) return "a path is relative: no leading slash";
  if (/^[A-Za-z]:/.test(rel)) return "a path is relative: no drive letter";
  if (rel.includes(":")) return "a path may not hold a colon (an NTFS stream name)";
  const parts = rel.split("/");
  if (parts.some((p) => p === "")) return "a path has no empty segment (no double or trailing slash)";
  if (parts.some((p) => p === "." || p === "..")) return "a path may not hold a . or .. segment";
  if (parts.some((p) => /[. ]$/.test(p))) return "a path segment may not end in a dot or a space (Windows drops them)";
  if (parts.some((p) => Buffer.byteLength(p) > 255)) return "a path segment is at most 255 bytes";
  if (parts.some(isDotGit)) return "a path may not write into .git (or a name a filesystem reads as .git)";
  return null;
}

/** @param {string} rel */
function assertRel(rel) {
  const why = relProblem(rel);
  if (why) throw new Error("refusing write-set path " + JSON.stringify(rel) + ": " + why);
}

/** Case-folded on filesystems that are usually case-insensitive. @param {string} p */
function fold(p) {
  return process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * The file operations apply uses. Tests pass a wrapper to make one fail; nothing else should.
 * @typedef {{ renameSync: typeof renameSync, rmSync: typeof rmSync, writeFileSync: typeof writeFileSync, mkdirSync: typeof mkdirSync }} WriteIo
 */

/** @type {WriteIo} */
const REAL_IO = { renameSync, rmSync, writeFileSync, mkdirSync };

/**
 * @typedef {object} WriteSetOptions
 * @property {string[]} [sources] source roots the target may not overlap (checked by apply)
 * @property {string} [kitRoot] the kit checkout the target may not overlap (checked by apply)
 * @property {Partial<WriteIo>} [io] for tests only
 */

/**
 * @typedef {object} WriteSet
 * @property {string} root the target as given, resolved
 * @property {(rel: string, content: string | Buffer) => void} write add (or replace) a write
 * @property {(rel: string) => void} remove add (or replace) a removal of a file or directory
 * @property {() => { rel: string, op: "write" | "remove", bytes: number }[]} list in the order entries were first added
 * @property {(opts?: { dryRun?: boolean }) => { written: string[], removed: string[], leftovers?: string[] }} apply
 *   leftovers: backup files phase 3 could not delete (absent when there are none)
 */

/**
 * Refuse a target root that another user could change under us (POSIX only): it must be owned by
 * this user, not writable by everyone, and group-writable only for this user's own primary group
 * (the usual private-group umask).
 * @param {string} real @param {import("node:fs").Stats} st
 */
function assertOwnedRoot(real, st) {
  if (typeof process.getuid !== "function" || process.platform === "win32") return;
  const uid = process.getuid();
  if (st.uid !== uid) throw new UsageError("the migration target " + real + " is owned by another user (uid " + st.uid + "); migrate into a directory you own", { title: "The migration target belongs to another user", why: "It is owned by uid " + st.uid + ": " + termLine(real) + ".", fix: "Migrate into a folder you own.", more: "npm run kit -- help" });
  if (st.mode & 0o002) throw new UsageError("the migration target " + real + " is writable by every user; chmod o-w it first", { title: "The migration target is writable by everyone", why: termLine(real) + " allows every user to write to it.", fix: "Run chmod o-w on it, then try again.", more: "npm run kit -- help" });
  const gid = typeof process.getgid === "function" ? process.getgid() : -1;
  if (st.mode & 0o020 && st.gid !== gid) throw new UsageError("the migration target " + real + " is writable by group " + st.gid + "; chmod g-w it first", { title: "The migration target is writable by a group", why: termLine(real) + " allows group " + st.gid + " to write to it.", fix: "Run chmod g-w on it, then try again.", more: "npm run kit -- help" });
}

/**
 * A write set for one target directory.
 * @param {string} targetRoot
 * @param {WriteSetOptions} [opts]
 * @returns {WriteSet}
 */
export function createWriteSet(targetRoot, opts = {}) {
  const root = resolve(targetRoot);
  const io = { ...REAL_IO, ...(opts.io ?? {}) };
  /** @type {Map<string, { op: "write", content: Buffer } | { op: "remove" }>} */
  const entries = new Map();

  /** Check every entry against the disk; throw on the first problem. @param {string} real */
  function validate(real) {
    const writes = [...entries].filter(([, e]) => e.op === "write").map(([rel]) => rel);
    const folded = new Set(writes.map(fold));
    for (const rel of writes) {
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join("/");
        if (folded.has(fold(parent))) throw new Error("write set writes " + parent + " as a file and as a folder of " + rel);
      }
    }
    const removes = [...entries].filter(([, e]) => e.op === "remove").map(([rel]) => fold(rel) + "/");
    for (const rel of writes) {
      const hit = removes.find((r) => fold(rel).startsWith(r));
      if (hit) throw new Error("write set removes " + hit.slice(0, -1) + " and writes " + rel + " inside it; split them into two steps");
    }
    for (const [rel, e] of entries) {
      assertNoLink(real, rel, { deep: e.op === "remove", who: "migrate", hint: " or migrate into a fresh target" });
      const abs = join(real, ...rel.split("/"));
      // Defence in depth: with no symlink below the real root this is lexical, so it cannot fire
      // unless the disk changes between the two checks.
      const resolved = realTarget(abs);
      if (!fold(resolved).startsWith(fold(real.endsWith(sep) ? real : real + sep))) throw new Error("refusing " + rel + ": it resolves outside the target " + real);
      // Every existing parent must be a directory, and an existing destination of a write a file.
      const parts = rel.split("/");
      let cur = real;
      let deepest = real;
      for (let i = 0; i < parts.length; i++) {
        cur = join(cur, /** @type {string} */ (parts[i]));
        let st;
        try {
          st = lstatSync(cur);
        } catch {
          break;
        }
        const last = i === parts.length - 1;
        if (!last && !st.isDirectory()) throw new Error("refusing " + rel + ": " + cur + " is not a directory");
        if (last && e.op === "write" && !st.isFile()) throw new Error("refusing " + rel + ": " + cur + " exists and is not a regular file");
        if (!last) deepest = cur;
      }
      // The folder phase 1 will create in or rename in must be writable.
      try {
        accessSync(deepest, constants.W_OK);
      } catch {
        throw new Error("refusing " + rel + ": " + deepest + " is not writable");
      }
    }
  }

  return {
    root,
    write(rel, content) {
      assertRel(rel);
      if (typeof content !== "string" && !Buffer.isBuffer(content)) throw new Error("write-set content for " + rel + " must be a string or a Buffer");
      entries.set(rel, { op: "write", content: typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content) });
    },
    remove(rel) {
      assertRel(rel);
      entries.set(rel, { op: "remove" });
    },
    list() {
      return [...entries].map(([rel, e]) => ({ rel, op: e.op, bytes: e.op === "write" ? e.content.length : 0 }));
    },
    apply({ dryRun = false } = {}) {
      if (opts.sources || opts.kitRoot) assertSafeTarget(root, { sources: opts.sources ?? [], kitRoot: opts.kitRoot ?? null });
      let st;
      try {
        st = lstatSync(root);
      } catch {
        throw new UsageError("the migration target " + root + " does not exist", { title: "The migration target does not exist", why: "There is nothing at " + termLine(root) + ".", fix: "Create the folder, or run npm run kit -- migrate:init <source> <target> --fidelity preserve|reskin.", more: "npm run kit -- help" });
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new UsageError("the migration target " + root + " must be a real directory, not a symbolic link or a file", { title: "The migration target is not a plain folder", why: termLine(root) + " is a symbolic link or a file.", fix: "Migrate into a real directory.", more: "npm run kit -- help" });
      const real = realpathSync(root);
      assertOwnedRoot(real, st);
      validate(real);
      /** @param {string} rel */
      const at = (rel) => join(real, ...rel.split("/"));
      const removes = [...entries].filter(([, e]) => e.op === "remove").map(([rel]) => rel);
      const writes = /** @type {[string, { op: "write", content: Buffer }][]} */ ([...entries].filter(([, e]) => e.op === "write"));
      const removed = removes.filter((rel) => existsSync(at(rel)) || isLink(at(rel)));
      if (dryRun) return { written: writes.map(([rel]) => rel), removed };

      const tag = ".migrate-" + process.pid + "-" + randomBytes(4).toString("hex");
      /** @param {string} dest @param {string} kind */
      const sibling = (dest, kind) => join(dirname(dest), "." + dest.slice(dirname(dest).length + 1) + tag + "." + kind);
      /** Undo log, newest last. @type {({ t: "dir", path: string } | { t: "tmp", path: string } | { t: "aside", from: string, to: string } | { t: "placed", dest: string, tmp: string })[]} */
      const log = [];
      /** @type {{ tmp: string, dest: string, parent: string }[]} */
      const staged = [];
      /** @type {string[]} */
      const backups = [];

      /** Undo every logged step, newest first; return what could not be undone. */
      const undo = () => {
        /** @type {string[]} */
        const stuck = [];
        for (const s of log.reverse()) {
          try {
            if (s.t === "tmp") io.rmSync(s.path, { force: true });
            else if (s.t === "placed") io.renameSync(s.dest, s.tmp);
            else if (s.t === "aside") io.renameSync(s.to, s.from);
            else rmdirSync(s.path);
          } catch {
            if (s.t === "dir") continue; // not empty: something else was put there meanwhile
            stuck.push(s.t === "aside" ? s.from + " is still at " + s.to : s.t === "placed" ? s.dest + " holds the new content (its temporary copy could not be moved back)" : s.path + " was left behind");
          }
        }
        // Temporary files that were moved back from their destinations are now removed.
        for (const s of staged) {
          try {
            io.rmSync(s.tmp, { force: true });
          } catch {
            stuck.push(s.tmp + " was left behind");
          }
        }
        return stuck;
      };
      /** @param {unknown} err @param {string} phase @returns {never} */
      const fail = (err, phase) => {
        const stuck = undo();
        const msg = /** @type {Error} */ (err)?.message ?? String(err);
        if (!stuck.length) throw new Error("write set not applied (" + phase + " failed and was rolled back): " + msg);
        throw new Error("write set failed in " + phase + " (" + msg + ") and could not be fully rolled back: " + stuck.join("; "));
      };

      // Phase 1: prepare.
      try {
        for (const [rel, e] of writes) {
          const dest = at(rel);
          mkdirs(dirname(dest), real, /** @type {any} */ (log), io);
          const tmp = sibling(dest, "tmp");
          // a file that replaces another keeps its permission bits, less the umask (a script stays executable)
          const mode = existsSync(dest) ? lstatSync(dest).mode & 0o777 : 0o666;
          // logged first: a write that fails half way still leaves a file to remove
          log.push({ t: "tmp", path: tmp });
          io.writeFileSync(tmp, e.content, { flag: "wx", mode });
          staged.push({ tmp, dest, parent: join(real, ...rel.split("/").slice(0, -1)) });
        }
        for (const s of staged) {
          if (!existsSync(s.dest)) continue;
          const bak = sibling(s.dest, "bak");
          io.renameSync(s.dest, bak);
          log.push({ t: "aside", from: s.dest, to: bak });
          backups.push(bak);
        }
        for (const rel of removed) {
          const bak = sibling(at(rel), "bak");
          io.renameSync(at(rel), bak);
          log.push({ t: "aside", from: at(rel), to: bak });
          backups.push(bak);
        }
      } catch (err) {
        fail(err, "prepare");
      }
      // Phase 2: commit.
      try {
        for (const s of staged) {
          if (realpathSync(dirname(s.tmp)) !== s.parent) throw new Error(dirname(s.dest) + " is no longer the folder that was checked");
          io.renameSync(s.tmp, s.dest);
          log.push({ t: "placed", dest: s.dest, tmp: s.tmp });
        }
      } catch (err) {
        fail(err, "commit");
      }
      // Phase 3: clean up.
      /** @type {string[]} */
      const leftovers = [];
      for (const b of backups) {
        try {
          io.rmSync(b, { recursive: true, force: true });
        } catch {
          leftovers.push(b);
        }
      }
      const out = { written: writes.map(([rel]) => rel), removed };
      return leftovers.length ? { ...out, leftovers } : out;
    },
  };
}

/**
 * mkdir -p below root, logging the directories it made (outermost first).
 * @param {string} dir @param {string} root @param {{ t: string, path: string }[]} log @param {WriteIo} io
 */
function mkdirs(dir, root, log, io) {
  /** @type {string[]} */
  const missing = [];
  let cur = dir;
  while (cur !== root && cur.length > root.length && !existsSync(cur)) {
    missing.unshift(cur);
    cur = dirname(cur);
  }
  for (const d of missing) {
    io.mkdirSync(d);
    log.push({ t: "dir", path: d });
  }
}

/** @param {string} p */
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Refuse a migration target that is, contains or sits inside a source root or the kit checkout,
 * compared by real path (a target that does not exist yet by its nearest existing ancestor), so a
 * symlink or a case variant cannot dodge it. A target that is itself a symbolic link is refused.
 * kitRoot null skips the kit check (a write set given sources only).
 * @param {string} target
 * @param {{ sources: string[], kitRoot: string | null }} opts
 */
export function assertSafeTarget(target, { sources, kitRoot }) {
  const abs = resolve(target);
  if (isLink(abs)) throw new UsageError(abs + " is a symbolic link; migrate into a real directory", { title: "The migration target is a symbolic link", why: termLine(abs) + " is a link, and a link could point anywhere.", fix: "Migrate into a real directory.", more: "npm run kit -- help" });
  const real = realTarget(abs);
  for (const s of sources) {
    const src = realTarget(resolve(s));
    if (pathsOverlap(real, src)) throw new UsageError("the migration target " + abs + " overlaps the source " + src + " (one is, or is inside, the other); the source is read-only, so migrate somewhere else", { title: "The migration target overlaps the source", why: termLine(abs) + " and " + termLine(src) + " are the same folder or one is inside the other, and the source is read-only.", fix: "Migrate into a folder outside the source.", more: "npm run kit -- help" });
  }
  if (kitRoot === null) return;
  const kit = realTarget(resolve(kitRoot));
  if (pathsOverlap(real, kit)) throw new UsageError("the migration target " + abs + " overlaps the kit checkout " + kit + "; migrate somewhere else", { title: "The migration target overlaps the kit checkout", why: termLine(abs) + " and " + termLine(kit) + " are the same folder or one is inside the other.", fix: "Migrate into a folder outside the kit.", more: "npm run kit -- help" });
}
