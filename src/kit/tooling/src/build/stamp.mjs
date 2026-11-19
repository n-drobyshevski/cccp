// Extracted from the author's production Apps Script apps; adapted.
//
// The build stamp: a content hash of everything that can change a bundle. It is shared by the
// build, the dev server and which-build, so they can never disagree.
//
// It is a hash of inputs, not a commit SHA: a SHA baked into a committed artifact is a fixpoint
// that does not exist (the commit that holds the build has no SHA yet). Same inputs give the
// same stamp, so a no-op rebuild causes no dist churn.
//
// Inputs: every ts/js/css/html/json file under <root>/src (this includes the vendored
// src/kit), package-lock.json, and the build config files named in STAMP_EXTRA_FILES (an app's
// build config must be one of those names; the list is fixed so which-build can replay it).
//
// src/kit must be a copy of the kit, not a symlink to a checkout elsewhere: a link is followed,
// so the stamp would then hash whatever the link points at today, and which-build run from
// another checkout would not reproduce it. A link back into the walk path (a cycle) is skipped.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files outside src/ that are hashed when present (relative to the app root). */
export const STAMP_EXTRA_FILES = ["package-lock.json", "esbuild.config.mjs", "build/esbuild.config.mjs"];

/**
 * @param {string} root app root
 * @returns {string} 12 hex chars
 */
export function sourceStamp(root) {
  const h = createHash("sha1");
  /** Length-prefixed so a name and content can never run together. @param {string} name @param {Buffer} buf */
  const feed = (name, buf) => h.update(name.length + ":" + name + "\0" + buf.length + ":").update(buf);
  // Real paths of the directories on the current walk path: a symlink back to one of them is a
  // cycle and is skipped, so the walk ends. The same directory linked from two places is fine.
  /** @type {Set<string>} */
  const stack = new Set();
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    let here;
    try { here = realpathSync(dir); } catch { return; }
    if (stack.has(here)) return;
    stack.add(here);
    try { walkEntries(dir, rel); } finally { stack.delete(here); }
  };
  /** @param {string} dir @param {string} rel */
  const walkEntries = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      const r = rel + "/" + e.name;
      let st;
      try { st = statSync(p); } catch { continue; } // statSync follows symlinks (a linked src/kit counts)
      if (st.isDirectory()) walk(p, r);
      else if (/\.(ts|js|mjs|css|html|json)$/.test(e.name)) feed(r, readFileSync(p));
    }
  };
  if (existsSync(join(root, "src"))) walk(join(root, "src"), "src");
  for (const f of STAMP_EXTRA_FILES) {
    const p = join(root, f);
    if (existsSync(p)) feed(f, readFileSync(p));
  }
  return h.digest("hex").slice(0, 12);
}

/**
 * @param {string} root
 * @returns {{ id: string, define: Record<string, string> }}
 */
export function buildStamp(root) {
  const id = sourceStamp(root);
  return { id, define: { __BUILD_ID__: JSON.stringify(id) } };
}
