// The names a reverse proxy gives the dev server, read from the environment. Pure: nothing here
// touches the network or the process, and nothing throws on a bad value.
//
// The dev server answers only to localhost and the host it is bound to (a DNS-rebinding guard). In
// a hosted shell or on a remote workstation the browser reaches it through an authenticated HTTPS
// proxy under another name, so that exact name has to be allowed, and the URL a person opens (and
// the /exec URL the fakes report) is the proxy's, not http://127.0.0.1:<port>.
//
//   WEB_HOST         set by Google Cloud Shell: Web Preview serves port <n> at https://<n>-$WEB_HOST.
//                    Allows the name <port>-<WEB_HOST> and makes https://<port>-<WEB_HOST> the public URL.
//   DEV_HOSTS        comma-separated exact host names of other proxies and port-forwarders;
//                    "{port}" stands for the bound port. No wildcards, no ports, no schemes.
//   DEV_PUBLIC_URL   an http(s) origin (no path, query or fragment; "{port}" allowed) that replaces
//                    the public URL. It does not allow a host name: name it in DEV_HOSTS too.

/** @typedef {Record<string, string | undefined>} Env */

/** Dot-separated labels of lowercase letters, digits and inner hyphens; at least one dot. */
const DNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Whether `name` is a plausible DNS host name, as it is written: lowercase letters, digits, dots
 * and hyphens, at least one dot, no empty label, at most 253 characters. A scheme, slash, colon
 * (so a port or an IPv6 literal), wildcard, space or capital letter fails.
 * @param {unknown} name
 * @returns {name is string}
 */
export function isHostName(name) {
  return typeof name === "string" && name.length <= 253 && DNS_NAME.test(name);
}

/** @param {unknown} port @returns {port is number} */
const isPort = (port) => typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;

/** @param {string} text @param {number} port */
const withPort = (text, port) => text.split("{port}").join(String(port));

/**
 * The Web Preview name of a port, or null when WEB_HOST is absent or not a host name.
 * @param {Env} env
 * @param {number} port
 */
function webPreviewHost(env, port) {
  const base = env ? env.WEB_HOST : undefined;
  if (!isPort(port) || !isHostName(base)) return null;
  const name = port + "-" + base;
  return isHostName(name) ? name : null;
}

/**
 * The extra host names the dev server answers to, beside localhost and its bound host: the Cloud
 * Shell Web Preview name of the port (WEB_HOST) and the exact names listed in DEV_HOSTS. Each
 * invalid DEV_HOSTS entry is skipped with one warning that names it.
 * @param {Env} env
 * @param {number} port the bound port
 * @param {(message: string) => void} [warn] default console.warn
 * @returns {string[]} lowercase, no duplicates
 */
export function previewHosts(env, port, warn = console.warn) {
  /** @type {string[]} */
  const out = [];
  if (!isPort(port)) return out;
  const preview = webPreviewHost(env, port);
  if (preview) out.push(preview);
  const list = env && typeof env.DEV_HOSTS === "string" ? env.DEV_HOSTS : "";
  for (const entry of list.split(",")) {
    const raw = entry.trim();
    if (!raw) continue;
    const name = withPort(raw.toLowerCase(), port);
    if (!isHostName(name)) {
      warn("DEV_HOSTS: ignored " + JSON.stringify(raw) + " (an exact host name is expected, such as {port}-dev.example.org: no scheme, port, path or wildcard)");
      continue;
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The URL a browser reaches the dev server at when that is not the local one: DEV_PUBLIC_URL when
 * it is a valid http(s) origin, else the Cloud Shell Web Preview URL of the port, else null. No
 * trailing slash. An invalid DEV_PUBLIC_URL is skipped with one warning.
 * @param {Env} env
 * @param {number} port the bound port
 * @param {(message: string) => void} [warn] default console.warn
 * @returns {string | null}
 */
export function publicUrl(env, port, warn = console.warn) {
  if (!isPort(port)) return null;
  const given = env && typeof env.DEV_PUBLIC_URL === "string" ? env.DEV_PUBLIC_URL.trim() : "";
  if (given) {
    const origin = originOf(withPort(given, port));
    if (origin) return origin;
    warn("DEV_PUBLIC_URL: ignored " + JSON.stringify(given) + " (an http or https URL with no path, query or fragment is expected, such as https://{port}-dev.example.org)");
  }
  const preview = webPreviewHost(env, port);
  return preview ? "https://" + preview : null;
}

/**
 * @param {string} text
 * @returns {string | null} scheme, host and port, when `text` is an http(s) URL and nothing more
 */
function originOf(text) {
  if (!/^https?:\/\/[^\s/?#@\\]+\/?$/i.test(text)) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash || !u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}
