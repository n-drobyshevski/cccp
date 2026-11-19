// Extracted from the author's production Apps Script apps; adapted.
//
// Redeploy the app's existing web-app deployment in place.
//
//   DEPLOYMENT_ID=AKfy... npm run deploy     push, cut a version, point THAT deployment at it
//
// In place is the default because a bare `clasp deploy` creates a new deployment, which is a
// new /exec URL: the bookmarked one keeps serving the old version. `clasp deploy -i <id>`
// repoints the existing deployment instead. So this REFUSES, rather than falling back, when
// DEPLOYMENT_ID is unset. The id is per installation and lives in the environment, not in the
// repo.
//
// Every in-place deploy cuts a new script version, and Apps Script keeps at most 200 per
// project. Past the cap the deploy fails; the old versions then have to be deleted by hand in
// the editor (Project history), which is why a failed deploy says so.
//
// `npm run push` runs first (build, then the app's check gate on that build, then `clasp push`;
// see push.mjs), then `clasp push --force`
// again, so a manifest-changed release cannot be skipped by clasp's prompt and still deploy. Node is spawned on the
// npm and clasp entry scripts directly, with no shell, so there are no .cmd shims or quoting
// rules to deal with.

import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { distId, isDevBundle } from "./whichBuild.mjs";

/**
 * @param {object} [opts] all injectable so tests never touch a network or a process
 * @param {string} [opts.root]
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {(cmd: string, args: string[], o: object) => { status: number | null }} [opts.spawn]
 * @param {(msg: string) => void} [opts.error]
 * @param {(root: string) => string | null} [opts.stamp] reads the id baked into dist (default distId)
 * @param {(root: string) => boolean} [opts.isDev] true when dist holds a dev build (default isDevBundle)
 * @param {(root: string) => string} [opts.claspBin]
 * @returns {number} exit code
 */
export function deploy(opts = {}) {
  const root = opts.root ?? process.cwd();
  const env = opts.env ?? process.env;
  const spawn = opts.spawn ?? ((cmd, args, o) => spawnSync(cmd, args, o));
  const error = opts.error ?? ((m) => console.error(m));
  const deploymentId = (env.DEPLOYMENT_ID ?? "").trim();

  if (!deploymentId) {
    error(
      "deploy: DEPLOYMENT_ID is not set, so there is no deployment to update in place.\n" +
      "  Set it to the web app's id (Deploy > Manage deployments, or `npx clasp deployments`):\n" +
      "    DEPLOYMENT_ID=AKfy... npm run deploy\n" +
      "  First deploy? Create the deployment once with `npx clasp deploy`, then set DEPLOYMENT_ID.",
    );
    return 1;
  }
  const npmCli = env.npm_execpath;
  if (!npmCli) {
    error("deploy: run this as `npm run deploy` from the app's directory.");
    return 1;
  }

  /** @param {string} script @param {string[]} args */
  const run = (script, args) => spawn(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" }).status ?? 1;

  const resolveClasp = opts.claspBin ?? ((r) => {
    const dir = join(r, "node_modules", "@google", "clasp");
    return join(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).bin.clasp);
  });

  let code = run(npmCli, ["run", "push"]);
  if (code !== 0) return code;
  // A dev build (the dev server's, marked) must never become a version, even if it was pushed.
  if ((opts.isDev ?? isDevBundle)(root)) {
    error("deploy: dist/server.js is a dev build (it carries the dev marker); refusing to cut a version. Run `npm run build` and push again; the dev server writes to dev/.cache/dist.");
    return 1;
  }
  // The id actually baked into the pushed bundle, which which-build resolves.
  const id = (opts.stamp ?? distId)(root);
  if (!id) {
    error("deploy: no build id found in dist/server.js after the push; refusing to cut an unlabelled version.");
    return 1;
  }
  // clasp 3 skips the push, and still exits 0, when the manifest differs and it cannot ask (no
  // TTY) or is answered no. Deploying then would cut a version from the old remote head. A forced
  // push is idempotent ("Script is already up to date."), so run it and deploy only if it is 0.
  const clasp = resolveClasp(root);
  code = run(clasp, ["push", "--force"]);
  if (code !== 0) {
    error("deploy: clasp push --force failed (exit " + code + "); not cutting a version from the old remote head.");
    return code;
  }
  code = run(clasp, ["deploy", "-i", deploymentId, "-d", "build " + id]);
  if (code !== 0) {
    error(
      "deploy: clasp deploy failed (exit " + code + "). If the error mentions a version limit: Apps Script keeps at " +
      "most 200 versions per project, and each deploy cuts one. Delete old versions in the editor " +
      "(Project history) and run the deploy again.",
    );
  }
  return code;
}

const real = (/** @type {string} */ p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exit(deploy());
}
