// Writes the vendored kit (src/kit) and its lock into an app.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { UsageError } from "./args.mjs";
import { printable } from "./source.mjs";
import { KIT_DIR, LOCK_FILE, buildLock, hashFiles, renderLock, vendorFiles } from "./hash.mjs";

/**
 * Refuse a destination that is, or sits below, a symlink in the target tree (a delete or a copy would
 * go through it). Walks every component of rel below root; with deep (the default) the whole existing
 * subtree of a directory is checked too.
 * @param {string} root
 * @param {string} rel posix path below root
 * @param {{ deep?: boolean, who?: string, hint?: string }} [opts] who names the command in the message
 *   ("gas-kit" by default); hint is appended to "Remove it"
 */
export function assertNoLink(root, rel, opts = {}) {
  let cur = root;
  for (const part of rel.split("/").filter(Boolean)) {
    cur = join(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) throw new UsageError(cur + " is a symbolic link; " + (opts.who ?? "gas-kit") + " will not write through it. Remove it" + (opts.hint ?? ""), { title: "A link is in the way, so nothing was written", why: printable(relative(root, cur).split(sep).join("/") || ".") + " is a symbolic link, which could lead outside this app, and gas-kit will not write through it.", fix: "Remove the link (it is only a shortcut), then run the command again.", more: "npm run kit -- help kit" });
  }
  if (opts.deep !== false && lstatSync(cur).isDirectory()) {
    for (const e of readdirSync(cur)) assertNoLink(root, relative(root, join(cur, e)).split(sep).join("/"), opts);
  }
}

/**
 * Replace src/kit with the files of a kit source and rewrite kit.lock.json. Refuses (before deleting
 * anything) when src, src/kit or kit.lock.json is a symbolic link.
 * @param {string} root the app root
 * @param {{ dir: string, version: string, commit: string | null, source: string, remote?: string | null | false }} src remote is
 *   the shareable kit repository URL to remember in the lock (already through shareableRemote), null, or
 *   false (a deliberate "no remote")
 * @returns {{ files: Record<string, string> }} path under src/kit to sha256
 */
export function writeVendored(root, src) {
  for (const rel of [KIT_DIR, LOCK_FILE]) assertNoLink(root, rel, { deep: false, who: "kit:sync", hint: " (src, src/kit and kit.lock.json must be real)" });
  const files = vendorFiles(src.dir);
  const hashes = hashFiles(files);
  rmSync(join(root, KIT_DIR), { recursive: true, force: true });
  for (const [rel, abs] of Object.entries(files)) {
    const dest = join(root, KIT_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
  }
  writeFileSync(join(root, LOCK_FILE), renderLock(buildLock({ version: src.version, commit: src.commit, source: src.source, remote: src.remote ?? null }, hashes)));
  return { files: hashes };
}
