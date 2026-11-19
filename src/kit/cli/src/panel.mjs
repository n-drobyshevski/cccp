// `ui`: a local control panel in the browser. It shows the doctor checks and runs the same actions as the home
// menu, and nothing else. It is a web server, so it is built to be hard to talk to for anything but the page it
// serves: 127.0.0.1 only; a fresh random token per run, given to the page in the address fragment (never sent to a
// server) and needed in a header on every POST; the address also sets a separate HttpOnly SameSite=Strict session
// cookie, named by port, that unlocks reading only (browsers share cookies between ports on 127.0.0.1);
// Host, Origin and a token header checked (DNS rebinding, cross-site requests); no CORS; a strict CSP with no
// inline script or style; JSON bodies only, 16 KB at most; a FIXED list of actions mapped to existing functions.
// Nothing from a request ever becomes a command, path or argument except validated values (a script id parsed by
// link, a version from the list the kit remote gave). Static files come from a fixed table, never from the URL.
// In Cloud Shell (CLOUD_SHELL set, no --no-web-preview) it also answers to its own Web Preview name, see previewHostPattern.
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { npmInvocation } from "./npm.mjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./args.mjs";
import { noLocalBrowser } from "./checks.mjs";
import { summarize } from "./doctor.mjs";
import { FriendlyError } from "./errors.mjs";
import { docsUrlOf } from "./docsUrl.mjs";
import { runLink } from "./link.mjs";
import { kitVersionOf, productOf, realChecks, whereAmI } from "./menu.mjs";
import { sanitize } from "./ui.mjs";
import { describeUpdate, listUpdates, runUpdate } from "./update.mjs";

// The docs address (DOCS_URL, docsUrlOf) lives in docsUrl.mjs, shared with help and the menu; re-exported unchanged.
export { DOCS_URL, docsUrlOf } from "./docsUrl.mjs";

/** Stop after this long with no request from a person. */
export const IDLE_MS = 30 * 60 * 1000;
/** The biggest request body. */
export const MAX_BODY = 16 * 1024;
/** Lines of job output kept (a ring: the oldest go first) and the longest line. */
export const MAX_LINES = 500;
const MAX_LINE = 2000;
const COOKIE_PREFIX = "gaskit_panel_";

/** The ports Web Preview offers in its menu, in order. In Cloud Shell with no --port the panel takes the first free one. */
export const PREVIEW_PORTS = [8080, 8081, 8082, 8083, 8084];
/** The longest `cloudshell get-web-preview-url` may take. */
export const PREVIEW_URL_TIMEOUT_MS = 3000;
const LABEL = "[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * The Web Preview host names of one port. Google documents the preview address as https://$PORT-$WEB_HOST, where
 * WEB_HOST is the VM's name under cloudshell.dev (seen as `cs-<n>-default.cs-<region>-<x>.cloudshell.dev`). So: the
 * port and a hyphen first (no other port), one or two DNS labels, and `.cloudshell.dev` at the very end (no suffix
 * such as `cloudshell.dev.example.com`, no port, no path).
 * @param {number} port
 */
export function previewHostPattern(port) {
  return new RegExp("^" + port + "-" + LABEL + "(?:\\." + LABEL + ")?\\.cloudshell\\.dev$");
}

/**
 * Which Web Preview host the panel accepts on a port: exactly `<port>-<WEB_HOST>` when WEB_HOST gives a name of that
 * form (this VM only), else any name matching previewHostPattern. Either way never more than the pattern.
 * @param {Record<string, string | undefined>} env @param {number} port @returns {(host: string) => boolean}
 */
export function previewHostCheck(env, port) {
  const pattern = previewHostPattern(port);
  const own = port + "-" + String(env["WEB_HOST"] ?? "").toLowerCase();
  return pattern.test(own) ? (host) => host === own : (host) => pattern.test(host);
}

/**
 * The preview link with the token, from a base address (the helper's output or https://<port>-<WEB_HOST>), or null when
 * the base is not an https address of a host the panel accepts. Keeps a numeric `authuser` (the Google account to use).
 * @param {string} base @param {string} token @param {(host: string) => boolean} accepts
 */
export function previewLink(base, token, accepts) {
  let u;
  try {
    u = new URL(String(base).trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password || !accepts(u.hostname)) return null;
  const user = u.searchParams.get("authuser");
  return "https://" + u.hostname + "/?" + (user && /^\d{1,2}$/.test(user) ? "authuser=" + user + "&" : "") + "t=" + token;
}

/** Ask Cloud Shell for the preview address of a port: fixed argv, no shell, a short timeout; "" when it is not there. @param {number} port @param {Record<string, string | undefined>} env */
export function webPreviewUrl(port, env) {
  try {
    const r = spawnSync("cloudshell", ["get-web-preview-url", "-p", String(port)], { encoding: "utf8", timeout: PREVIEW_URL_TIMEOUT_MS, shell: false, env: /** @type {NodeJS.ProcessEnv} */ (env), stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 });
    return r.status === 0 ? String(r.stdout ?? "").trim() : "";
  } catch {
    return "";
  }
}

/** The npm scripts a job may run, by action name (never a value from a request). */
export const ACTIONS = { check: "check", dev: "dev", push: "push" };

/** The Content-Security-Policy of every response. */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The files the panel serves, by exact path. The URL is only a key into this table; it is never joined to a path. */
const here = (/** @type {string} */ rel) => fileURLToPath(new URL(rel, import.meta.url));
export const STATIC = {
  "/": { file: here("./panel/index.html"), type: "text/html; charset=utf-8" },
  "/panel.js": { file: here("./panel/panel.js"), type: "text/javascript; charset=utf-8" },
  "/panel.css": { file: here("./panel/panel.css"), type: "text/css; charset=utf-8" },
  // The ui package sits next to the cli both in the kit repository and in an app's src/kit.
  "/tokens.base.css": { file: here("../../ui/src/styles/tokens.base.css"), type: "text/css; charset=utf-8" },
  "/brand.css": { file: here("../../ui/src/styles/brand.css"), type: "text/css; charset=utf-8" },
};

/** Constant-time string equality (both sides hashed first, so lengths do not leak). @param {unknown} a @param {unknown} b */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** The value of one cookie from a Cookie header. @param {string | undefined} header @param {string} name */
export function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/**
 * @typedef {object} PanelOptions
 * @property {string} [root] the app folder (default ".")
 * @property {number} [port] 0 picks a free one; left out it is 0, or in Cloud Shell the first free one of PREVIEW_PORTS
 * @property {boolean} [preview] also answer to the Web Preview host (default: CLOUD_SHELL is set)
 * @property {number[]} [ports] the ports tried in Cloud Shell (tests; default PREVIEW_PORTS)
 * @property {Record<string, string | undefined>} [env]
 * @property {() => number} [now] the clock (tests)
 * @property {number} [idleMs] default IDLE_MS
 * @property {number} [tickMs] how often idleness is checked (default 15 s)
 * @property {(url: string) => void} [open] opens the page (default the platform opener; tests inject)
 * @property {typeof nodeSpawn} [spawn] starts an npm script (tests)
 * @property {(root: string, offline: boolean) => import("./checks.mjs").CheckResult[]} [checks]
 * @property {{ list?: typeof listUpdates, describe?: typeof describeUpdate, apply?: (root: string, version: string) => Promise<string[]> }} [updates] (tests)
 */

/**
 * @typedef {object} Panel
 * @property {string} url the address to open, with the token
 * @property {number} port @property {string} token the POST header token (only ever in the address fragment)
 * @property {string} cookie the session cookie, name=value (reads only; not the token)
 * @property {((host: string) => boolean) | null} preview the Web Preview host check, null outside Cloud Shell
 * @property {Promise<string>} closed resolves with why it stopped
 * @property {(why?: string) => void} close
 * @property {() => void} checkIdle
 * @property {import("node:http").Server} server
 */

/** Open an address with the platform opener: no shell, failures ignored, only our own loopback address. @param {string} url @param {typeof nodeSpawn} [spawnFn] (tests) */
export function openPanelUrl(url, spawnFn = nodeSpawn) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/\?t=[0-9a-f]{64}$/.test(url)) throw new Error("the panel only opens its own address");
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawnFn(/** @type {string} */ (cmd), /** @type {string[]} */ (args), { stdio: "ignore", shell: false, detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* the address is printed too */
  }
}

/** @param {unknown} e a thrown error as { error, why, fix } for the page, every string sanitised */
function errorBody(e) {
  if (e instanceof FriendlyError && e.title) return { error: sanitize(e.title), why: sanitize([e.why].flat().join(" ")), fix: sanitize([e.fix].flat().join(" ")) };
  return { error: sanitize(e instanceof Error ? e.message : "That did not work") };
}

/**
 * Start the panel. Resolves once it is listening on 127.0.0.1.
 * @param {PanelOptions} [opts]
 * @returns {Promise<Panel>}
 */
export async function startPanel(opts = {}) {
  const env = opts.env ?? process.env;
  const root = resolve(opts.root ?? ".");
  const where = whereAmI(root);
  if (where !== "app") {
    throw new FriendlyError({ title: where === "kit" ? "The control panel works on an app, not on the kit itself" : "There is no app in this folder", why: where === "kit" ? "Putting online, connecting and updating only make sense in an app made with gas-kit." : "The control panel works on a gas-kit app.", fix: "Open it from your app's folder, or pass --root <folder>.", exitCode: 2 });
  }
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const spawn = opts.spawn ?? nodeSpawn;
  const checks = opts.checks ?? ((r, offline) => realChecks(r, env, offline));
  const updates = { list: listUpdates, describe: describeUpdate, ...opts.updates };
  const token = randomBytes(32).toString("hex");
  // A second secret for the cookie, so the cookie (which every port on 127.0.0.1 shares) never carries the token.
  const session = randomBytes(32).toString("hex");
  const preview = opts.preview ?? Boolean(env["CLOUD_SHELL"]);
  let port = 0;
  /** @type {((host: string) => boolean) | null} */
  let previewHost = null;
  let last = now();
  let busy = false;
  /** @type {{ script: string, state: "running" | "done" | "failed", code: number | null, lines: string[], child: any } | null} */
  let job = null;
  /** @type {(why: string) => void} */
  let resolveClosed = () => {};
  const closed = new Promise((r) => (resolveClosed = r));

  /** @param {import("node:http").ServerResponse} res @param {number} status @param {string | Buffer} body @param {Record<string, string | string[]>} [extra] */
  function send(res, status, body, extra = {}) {
    res.writeHead(status, {
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(body),
      ...extra,
    });
    res.end(body);
  }
  /** @param {import("node:http").ServerResponse} res @param {number} status @param {unknown} data */
  const json = (res, status, data) => send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8" });
  /** @param {import("node:http").ServerResponse} res @param {number} status @param {string} message */
  const refuse = (res, status, message) => json(res, status, { error: message });

  /** @param {import("node:http").IncomingMessage} req @returns {Promise<{ status: number, text: string }>} */
  function readBody(req) {
    return new Promise((done) => {
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return done({ status: 413, text: "" });
      /** @type {Buffer[]} */
      const parts = [];
      let size = 0;
      req.on("data", (/** @type {Buffer} */ c) => {
        size += c.length;
        if (size > MAX_BODY) {
          parts.length = 0;
          done({ status: 413, text: "" });
          req.removeAllListeners("data");
          return;
        }
        parts.push(c);
      });
      req.on("end", () => done({ status: 200, text: Buffer.concat(parts).toString("utf8") }));
      req.on("error", () => done({ status: 400, text: "" }));
    });
  }

  // ---- jobs: one at a time, fixed npm scripts, output in a ring buffer
  /** @param {string} line */
  function addLine(line) {
    if (!job) return;
    job.lines.push(sanitize(line).slice(0, MAX_LINE));
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
  }
  /** @param {string} script */
  function startJob(script) {
    /** @type {{ script: string, state: "running" | "done" | "failed", code: number | null, lines: string[], child: any }} */
    const j = { script, state: "running", code: null, lines: [], child: null };
    job = j;
    const finish = (/** @type {number | null} */ code) => {
      if (j.state !== "running") return;
      j.state = code === 0 ? "done" : "failed";
      j.code = code;
      j.child = null;
    };
    try {
      const run = npmInvocation("npm", ["run", script]);
      const child = spawn(run.cmd, run.args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: process.platform !== "win32", env: /** @type {NodeJS.ProcessEnv} */ (env) });
      j.child = child;
      for (const stream of [child.stdout, child.stderr]) {
        let rest = "";
        stream?.on("data", (/** @type {Buffer} */ b) => {
          const parts = (rest + String(b)).split("\n");
          rest = parts.pop() ?? "";
          if (job === j) parts.forEach(addLine);
        });
        stream?.on("end", () => {
          if (rest && job === j) addLine(rest);
          rest = "";
        });
      }
      child.on("error", () => {
        if (job === j) addLine("Could not start npm run " + script + ". Run it yourself in a terminal in this folder.");
        finish(null);
      });
      child.on("close", (/** @type {number | null} */ code) => finish(code));
    } catch {
      addLine("Could not start npm run " + script + ". Run it yourself in a terminal in this folder.");
      finish(null);
    }
  }
  /** Stop the running job and its children. */
  function killJob() {
    const child = job?.child;
    if (!child) return;
    try {
      if (process.platform !== "win32" && typeof child.pid === "number") process.kill(-child.pid, "SIGTERM");
      else child.kill();
    } catch {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
  }

  // ---- routes
  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res @param {string} path @param {URL} url */
  async function api(req, res, path, url) {
    if (req.method === "GET") {
      if (path === "/api/status") {
        const results = where === "empty" ? [] : checks(root, url.searchParams.get("offline") === "1");
        const view = results.map((r) => ({ id: r.id, status: r.status, title: r.title, detail: r.detail, ...(r.fix ? { fix: { label: r.fix.label, terminal: r.fix.command.length > 0 } } : {}) }));
        return json(res, 200, { where, product: where === "app" ? productOf(root) : "gas-kit", kitVersion: kitVersionOf(root), docsUrl: where === "app" ? docsUrlOf(root, env) : null, checks: view, summary: summarize(results) });
      }
      if (path === "/api/job") {
        return json(res, 200, job ? { state: job.state, script: job.script, code: job.code, lines: job.lines } : { state: "idle", script: "", code: null, lines: [] });
      }
      if (path === "/api/update") {
        const info = updates.list(root, env);
        const versions = info.newer.map((t) => t.version);
        const asked = url.searchParams.get("version");
        if (asked !== null) {
          if (!versions.includes(asked)) return refuse(res, 400, "That version is not in the list");
          return json(res, 200, updates.describe(root, env, asked));
        }
        return json(res, 200, { current: info.current, versions, selected: versions[0] ? updates.describe(root, env, versions[0]) : null });
      }
      return refuse(res, 404, "Not found");
    }
    /* POST: the body is already checked to be a JSON object */
    const body = /** @type {Record<string, unknown>} */ (/** @type {any} */ (req).gasKitBody);
    if (path === "/api/run") {
      const action = body["action"];
      if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action)) return refuse(res, 400, "Unknown action");
      if (busy || job?.state === "running") return refuse(res, 409, "Another job is running. Wait for it to finish, or stop it.");
      startJob(/** @type {Record<string, string>} */ (ACTIONS)[action] ?? "check");
      return json(res, 202, { ok: true });
    }
    if (path === "/api/stop") {
      killJob();
      return json(res, 200, { ok: true });
    }
    if (path === "/api/link") {
      const script = body["script"];
      if (typeof script !== "string") return refuse(res, 400, "script must be the project address or id");
      if (!script.trim()) return refuse(res, 400, "Paste the web address of your project first.");
      if (busy || job?.state === "running") return refuse(res, 409, "Another job is running. Wait for it to finish, or stop it.");
      busy = true;
      try {
        // --yes keeps runLink from asking anything on the terminal this runs in; parseScriptId runs inside it.
        const r = await runLink({ positional: [], flags: { root, script, yes: true, ...(body["force"] === true ? { force: true } : {}) } }, { env });
        return json(res, 200, { ok: true, message: sanitize(r.lines.join(" ")) });
      } catch (e) {
        // runLink's fix names a terminal flag; the page has a box for it instead.
        if (e instanceof FriendlyError && [e.fix].flat().join(" ").includes("--force")) return refuse(res, 409, "This app is already linked to another project. Tick the box to replace it, then connect again.");
        throw e;
      } finally {
        busy = false;
      }
    }
    if (path === "/api/update") {
      const version = body["version"];
      if (body["confirm"] !== true) return refuse(res, 400, "Tick the box to confirm the update");
      if (typeof version !== "string") return refuse(res, 400, "version must be one from the list");
      if (!updates.list(root, env).newer.some((t) => t.version === version)) return refuse(res, 400, "That version is not in the list");
      if (busy || job?.state === "running") return refuse(res, 409, "Another job is running. Wait for it to finish, or stop it.");
      busy = true;
      try {
        const lines = updates.apply ? await updates.apply(root, version) : (await runUpdate({ positional: [], flags: { root, to: version, yes: true } }, { env })).lines;
        const tail = lines.slice(-1).join(" ");
        return json(res, 200, { ok: true, message: sanitize(tail.startsWith("Updated to") ? tail : "Updated to " + version + ". " + tail) });
      } finally {
        busy = false;
      }
    }
    return refuse(res, 404, "Not found");
  }

  /** The cookie name carries the port, so two panels in one browser do not overwrite each other. */
  const cookieName = () => COOKIE_PREFIX + port;
  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  async function handle(req, res) {
    const allowedHosts = ["127.0.0.1:" + port, "localhost:" + port];
    const host = String(req.headers.host ?? "").toLowerCase();
    // 1. Host: anything else is a DNS-rebinding page (or a mistake) and gets nothing. In Cloud Shell also this
    //    port's Web Preview name (Google's proxy, which lets only the VM's own account through, keeps that Host).
    if (!allowedHosts.includes(host) && !previewHost?.(host)) return refuse(res, 421, "Wrong host");
    const method = req.method ?? "";
    if (method !== "GET" && method !== "POST") return send(res, 405, "", { Allow: "GET, POST" });
    const rawUrl = req.url ?? "";
    if (!rawUrl.startsWith("/")) return refuse(res, 400, "Bad request");
    let url;
    try {
      url = new URL(rawUrl, "http://127.0.0.1");
    } catch {
      return refuse(res, 400, "Bad request");
    }
    const path = url.pathname;
    // 2. The address sets the session cookie and hands the token on in the fragment (a fragment is never sent to
    //    any server). The address keeps working for the whole run.
    if (method === "GET" && path === "/" && url.searchParams.has("t")) {
      if (!safeEqual(url.searchParams.get("t"), token)) return refuse(res, 403, "Wrong token");
      last = now();
      // In Cloud Shell the page is https on Google's proxy, so the cookie is Secure. It is Lax there, not Strict: the
      // address is opened from another site (the Cloud console, or the proxy's sign-in redirect), and a Strict cookie
      // set in that navigation is not sent on its own redirect to "/". Lax still keeps it off cross-site subrequests,
      // it only unlocks reads, and every POST still needs the exact Origin and the token header.
      const attrs = preview ? "; HttpOnly; Secure; SameSite=Lax; Path=/" : "; HttpOnly; SameSite=Strict; Path=/";
      return send(res, 302, "", { Location: "/#" + token, "Set-Cookie": cookieName() + "=" + session + attrs });
    }
    // 3. Everything else needs the cookie.
    if (!safeEqual(cookieValue(req.headers.cookie, cookieName()), session)) return send(res, 403, "Open the address printed in the terminal (it has ?t=...) to use the panel.", { "Content-Type": "text/plain; charset=utf-8" });
    if (method === "POST") {
      const origin = String(req.headers.origin ?? "");
      const viaPreview = origin.startsWith("https://") && Boolean(previewHost?.(origin.slice("https://".length)));
      if (!allowedHosts.some((h) => origin === "http://" + h) && !viaPreview) return refuse(res, 403, "Wrong origin");
      if (!safeEqual(req.headers["x-gas-kit-token"], token)) return refuse(res, 403, "Wrong token");
      if (!/^application\/json\s*(;\s*charset=utf-8)?$/i.test(String(req.headers["content-type"] ?? ""))) return refuse(res, 415, "JSON only");
      const got = await readBody(req);
      if (got.status !== 200) {
        send(res, got.status, JSON.stringify({ error: got.status === 413 ? "Too big" : "Bad request" }), { "Content-Type": "application/json; charset=utf-8", Connection: "close" });
        return;
      }
      /** @type {unknown} */
      let parsed;
      try {
        parsed = JSON.parse(got.text);
      } catch {
        return refuse(res, 400, "Not JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(res, 400, "Send a JSON object");
      /** @type {any} */ (req).gasKitBody = parsed;
    }
    if (path !== "/api/job") last = now();
    if (path.startsWith("/api/")) {
      try {
        return await api(req, res, path, url);
      } catch (e) {
        return json(res, e instanceof FriendlyError || e instanceof UsageError ? 400 : 500, e instanceof FriendlyError || e instanceof UsageError ? errorBody(e) : { error: "That did not work" });
      }
    }
    // 4. The docs link: one fixed redirect to the address docsUrlOf validated (the app's config or GAS_KIT_DOCS_URL).
    // Nothing from the request (query, tail, header) picks the target, so it is no open redirect.
    if (path === "/docs") {
      const to = method === "GET" && where === "app" ? docsUrlOf(root, env) : null;
      if (!to) return refuse(res, 404, "Not found");
      return send(res, 302, "", { Location: to });
    }
    // 5. Static files: only the fixed table; a POST here is not a thing.
    let file = method === "GET" && Object.hasOwn(STATIC, path) ? /** @type {Record<string, { file: string, type: string }>} */ (STATIC)[path] : undefined;
    if (!file) return refuse(res, 404, "Not found");
    // The app's own accent colour: one fixed file in the app, used only if it is a plain file (never a link).
    if (path === "/brand.css") {
      const own = join(root, "src", "client", "styles", "brand.css");
      try {
        if (lstatSync(own).isFile()) file = { file: own, type: file.type };
      } catch {
        /* no own brand: the kit default */
      }
    }
    try {
      return send(res, 200, readFileSync(file.file), { "Content-Type": file.type });
    } catch {
      return refuse(res, 404, "Not found");
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) refuse(res, 500, "That did not work");
      else res.end();
    });
  });
  // An explicit port is the only one tried. In Cloud Shell with none, the ports Web Preview offers, in order.
  const tries = opts.port !== undefined ? [opts.port] : preview ? (opts.ports ?? PREVIEW_PORTS) : [0];
  let listening = false;
  for (const p of tries) {
    listening = await new Promise((ok, fail) => {
      const onError = (/** @type {NodeJS.ErrnoException} */ e) => {
        server.off("listening", onListening);
        if (e.code === "EADDRINUSE") ok(false);
        else fail(e);
      };
      const onListening = () => {
        server.off("error", onError);
        ok(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, "127.0.0.1");
    });
    if (listening) break;
  }
  if (!listening) {
    if (tries.length > 1) throw new FriendlyError({ title: "The Web Preview ports are all in use", why: "In Cloud Shell the panel uses a port Web Preview offers, and ports " + tries[0] + " to " + tries[tries.length - 1] + " are taken.", fix: "Stop one of those programs, or pass --port <a number from 2000 to 65000> and use Web Preview, Change port.", exitCode: 2 });
    throw new FriendlyError({ title: "That port is already in use", why: "Another program is listening on port " + (opts.port ?? 0) + ".", fix: "Leave out --port to let the panel pick a free one.", exitCode: 2 });
  }
  // As before this loop, one later server error is ignored rather than thrown.
  server.once("error", () => {});
  port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  if (preview) previewHost = previewHostCheck(env, port);

  let done = false;
  /** @param {string} [why] */
  function close(why = "closed") {
    if (done) return;
    done = true;
    clearInterval(timer);
    killJob();
    server.close();
    server.closeAllConnections();
    resolveClosed(why);
  }
  function checkIdle() {
    if (now() - last > idleMs) close("idle");
  }
  const timer = setInterval(checkIdle, opts.tickMs ?? 15000);
  timer.unref();
  return { url: "http://127.0.0.1:" + port + "/?t=" + token, port, token, cookie: cookieName() + "=" + session, preview: previewHost, closed, close, checkIdle, server };
}

/**
 * The `ui` command: start, print the address, open it, wait for Ctrl-C or idleness.
 * @param {{ positional: string[], flags: Record<string, string | boolean> }} parsed
 * @param {{ env?: Record<string, string | undefined>, say?: (lines: string[]) => void, ready?: (p: Panel) => void, previewUrl?: (port: number, env: Record<string, string | undefined>) => string } & PanelOptions} [opts]
 * @returns {Promise<{ lines: string[], code: number }>}
 */
export async function runUi(parsed, opts = {}) {
  const env = opts.env ?? process.env;
  const say = opts.say ?? (() => {});
  const portFlag = parsed.flags["port"];
  /** @type {number | undefined} */
  let port;
  if (portFlag !== undefined) {
    if (typeof portFlag !== "string" || !/^\d{1,5}$/.test(portFlag) || Number(portFlag) > 65535) throw new UsageError("--port needs a number from 0 to 65535", { title: "--port needs a number", why: "A port is a number from 0 to 65535.", fix: "Write --port 4000, or leave it out to let the panel pick a free one.", more: "npm run kit -- help" });
    port = Number(portFlag);
  }
  const rootFlag = parsed.flags["root"];
  if (rootFlag === "") throw new UsageError("--root needs a folder", { title: "--root needs a folder", why: "The flag was given with nothing after it.", fix: "Write --root <your app's folder>, or leave it out to use this folder.", more: "npm run kit -- help" });
  const panel = await startPanel({ ...opts, env, port, root: typeof rootFlag === "string" ? rootFlag : (opts.root ?? "."), ...(parsed.flags["no-web-preview"] === true ? { preview: false } : {}) });
  const noOpen = parsed.flags["no-open"] === true || noLocalBrowser(env);
  const tail = ["", "  Anyone who can read this address can use the panel, so do not share it.", "  Press Ctrl-C to stop it (it also stops after " + Math.round((opts.idleMs ?? IDLE_MS) / 60000) + " minutes with no use)."];
  if (panel.preview) {
    // Cloud Shell: the token is printed here only, in the link or in the words to finish it by hand.
    const accepts = panel.preview;
    const link = previewLink((opts.previewUrl ?? webPreviewUrl)(panel.port, env), panel.token, accepts) ?? (env["WEB_HOST"] ? previewLink("https://" + panel.port + "-" + env["WEB_HOST"], panel.token, accepts) : null);
    if (link) say(["", "  The control panel is running. Open this address in your browser (Cloud Shell Web Preview):", "    " + link, ...tail]);
    else say(["", "  The control panel is running on port " + panel.port + ". To open it in Cloud Shell:", "    Web Preview → Preview on port " + panel.port + (PREVIEW_PORTS.includes(panel.port) ? "" : " (Change port)") + ", then add ?t=" + panel.token + " to the address", "    (after the last /, in place of anything already there).", ...tail]);
  } else say(["", "  The control panel is running. Open this address in your browser:", "    " + panel.url, ...tail]);
  if (!noOpen) (opts.open ?? openPanelUrl)(panel.url);
  const stop = () => panel.close("interrupt");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  opts.ready?.(panel);
  const why = await panel.closed;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  say(["", why === "idle" ? "  The control panel stopped: nothing used it for " + Math.round((opts.idleMs ?? IDLE_MS) / 60000) + " minutes. A job it started (such as the preview) was stopped too." : "  The control panel stopped.", ""]);
  return { lines: [], code: 0 };
}
