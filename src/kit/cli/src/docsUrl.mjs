// The kit docs address an app may name: the panel's "Kit docs" link, the help overview and the menu's Guides
// and help show it. One pattern and one reader, so the three never disagree on what is allowed.
// Internal module (no dependencies).
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The only docs address the kit shows or links to: https on script.google.com, optionally a web app path
 * (/a/macros/<domain>/s/<id>/exec or /macros/s/<id>/exec). Anchored right after the host, so a user, a password
 * or a port never matches.
 */
export const DOCS_URL = /^https:\/\/script\.google\.com(?:\/?|\/a\/macros\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/s\/[A-Za-z0-9_-]{10,200}\/exec|\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec)$/;

/**
 * The kit docs address, or null (show nothing). GAS_KIT_DOCS_URL wins over `docsUrl` in the app's
 * app.config.mjs, which is read as text and never imported, like productOf. Anything DOCS_URL refuses is null.
 * @param {string} root @param {Record<string, string | undefined>} env @returns {string | null}
 */
export function docsUrlOf(root, env) {
  let v = env["GAS_KIT_DOCS_URL"];
  if (!v) {
    try {
      v = /^\s*docsUrl:\s*"([^"\n]{0,300})"/m.exec(readFileSync(join(root, "app.config.mjs"), "utf8"))?.[1];
    } catch {
      v = "";
    }
  }
  return v && DOCS_URL.test(v) ? v : null;
}
