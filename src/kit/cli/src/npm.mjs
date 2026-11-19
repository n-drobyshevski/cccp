// How the CLI starts npm and npx without a shell. Node releases patched for CVE-2024-27980 refuse to spawn a
// .cmd file with shell: false, so on Windows node runs npm's own JavaScript entry (npm-cli.js, npx-cli.js).
import { existsSync } from "node:fs";
import { win32 } from "node:path";

/**
 * What to spawn for npm or npx, with no shell. Off Windows the command is returned unchanged. On Windows the entry
 * script comes from npm_execpath (set when npm started us) or else from node_modules/npm/bin beside node.exe; when
 * neither is found the plain command comes back and the caller reports "run it yourself".
 * @param {string} cmd "npm" or "npx" @param {string[]} args @param {string} [platform] @param {Record<string, string | undefined>} [env]
 * @param {string} [nodePath] @param {(p: string) => boolean} [exists] (tests)
 * @returns {{ cmd: string, args: string[] }}
 */
export function npmInvocation(cmd, args, platform = process.platform, env = process.env, nodePath = process.execPath, exists = existsSync) {
  if (platform !== "win32" || (cmd !== "npm" && cmd !== "npx")) return { cmd, args };
  const entry = cmd + "-cli.js";
  const exec = env["npm_execpath"];
  if (exec && /[\\/]np[mx]-cli\.c?js$/i.test(exec)) {
    // npm_execpath is npm-cli.js or npx-cli.js; the other one sits beside it.
    const beside = win32.join(win32.dirname(exec), entry);
    if (beside === exec || exists(beside)) return { cmd: nodePath, args: [beside, ...args] };
  }
  const bundled = win32.join(win32.dirname(nodePath), "node_modules", "npm", "bin", entry);
  if (exists(bundled)) return { cmd: nodePath, args: [bundled, ...args] };
  return { cmd, args };
}
