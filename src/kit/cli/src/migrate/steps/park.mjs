// The park step: every source file the migration may still port is copied, byte for byte, to
// .migrate/pending/<key> (ESLint ignores it), so nothing of the source is lost while the pages and
// the server are ported one step at a time. A step that ports a file removes its pending copy.
// Skipped files (symlinks, secrets, binaries, over the caps) and .clasp.json (a script id) are never copied.
import { comparableName } from "../sourceTree.mjs";
import { PENDING, pendingPath } from "./_common.mjs";

const KINDS = new Set(["js", "ts", "gs", "html", "css", "json", "md"]);

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const skipped = new Set(ctx.inv.skipped.map((s) => s.key));
  let n = 0;
  for (const f of ctx.inv.files) {
    if (!KINDS.has(f.kind) || skipped.has(f.key)) continue;
    // The clasp file names the source's script id; it stays out of the new app.
    if (f.key.split("/").some((seg) => comparableName(seg) === ".clasp.json")) continue;
    ctx.out.write(pendingPath(f.key), ctx.tree.readBytes(f.key));
    n++;
  }
  return { notes: ["parked " + n + " source file" + (n === 1 ? "" : "s") + " under " + PENDING] };
}
