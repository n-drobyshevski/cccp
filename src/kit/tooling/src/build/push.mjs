// Build, check, then push: the order that makes the dist contracts check the bundle clasp pushes.
//
//   npm run push      (the app's tools/push.mjs calls push())
//
// 1. `npm run build` first. The build runs its own guards on the fresh output (the middlebox
//    replay, the server globals, the noSecrets patterns over dist; see defineBuild).
// 2. `npm run check` (typecheck, lint, tests, and kit:verify in a scaffolded app) with
//    GAS_KIT_PUSH=1 in its environment. The app's contracts test reads that flag: in a push run its
//    dist block must find dist and fails instead of skipping when there is none, so the guards on
//    dist run on what is about to be pushed.
// 3. `clasp push --force`, only when both exited 0, and never for a dev build (the dev marker).
//
// Checking first and building after (the old order) let the contracts read the previous dist, or
// skip with none, while a define or a global they would have refused went out. Node is spawned on
// the npm and clasp entry scripts directly, with no shell, as in deploy.mjs.
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isDevBundle } from "./whichBuild.mjs";

/** The environment flag a push run sets for the app's tests. */
export const PUSH_ENV = "GAS_KIT_PUSH";

/**
 * True when the tests run inside npm run push (PUSH_ENV is "1"): the dist block must not skip.
 * @param {Record<string, string | undefined>} [env]
 */
export const isPushRun = (env = process.env) => env[PUSH_ENV] === "1";

/**
 * @param {object} [opts] all injectable so tests never touch a network or a process
 * @param {string} [opts.root]
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {(cmd: string, args: string[], o: { cwd: string, stdio: "inherit", env: Record<string, string | undefined> }) => { status: number | null }} [opts.spawn]
 * @param {(msg: string) => void} [opts.error]
 * @param {(root: string) => boolean} [opts.isDev] true when dist holds a dev build (default isDevBundle)
 * @param {(root: string) => string} [opts.claspBin]
 * @param {string} [opts.checkScript] the npm script that checks the app (default check)
 * @returns {number} exit code
 */
export function push(opts = {}) {
  const root = opts.root ?? process.cwd();
  const env = opts.env ?? process.env;
  const spawn = opts.spawn ?? ((cmd, args, o) => spawnSync(cmd, args, o));
  const error = opts.error ?? ((m) => console.error(m));
  const npmCli = env.npm_execpath;
  if (!npmCli) {
    error("push: run this as `npm run push` from the app's directory.");
    return 1;
  }
  /** @param {string} script @param {string[]} args @param {Record<string, string | undefined>} e */
  const run = (script, args, e) => spawn(process.execPath, [script, ...args], { cwd: root, stdio: "inherit", env: e }).status ?? 1;

  let code = run(npmCli, ["run", "build"], env);
  if (code !== 0) {
    error("push: the build failed (exit " + code + "); nothing was pushed.");
    return code;
  }
  code = run(npmCli, ["run", opts.checkScript ?? "check"], { ...env, [PUSH_ENV]: "1" });
  if (code !== 0) {
    error("push: the checks failed on the fresh build (exit " + code + "); nothing was pushed.");
    return code;
  }
  if ((opts.isDev ?? isDevBundle)(root)) {
    error("push: dist/server.js is a dev build (it carries the dev marker); refusing to push it.");
    return 1;
  }
  const resolveClasp = opts.claspBin ?? ((r) => {
    const dir = join(r, "node_modules", "@google", "clasp");
    return join(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).bin.clasp);
  });
  return run(resolveClasp(root), ["push", "--force"], env);
}

const real = (/** @type {string} */ p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exit(push());
}
