// Outbound HTTPS calls: the one kit module that names UrlFetchApp (the noDangerousServerApis
// contract allows it in a file named fetch.ts and nowhere else).
//
//   const http = createFetch({ hosts: ["api.example.org"], secrets });
//   const items = http.fetchJson(ITEMS_URL, { headers: { Authorization: "Bearer " + secrets.get("ACME_TOKEN") } });
//
// Under USER_DEPLOYING every request leaves as the deploying account, with whatever credential
// the caller attaches, so the rules are fixed here rather than left to each call:
//   - https only, and the host must equal one of `hosts` exactly: no wildcard, no suffix match
//     (api.example.org.evil.example is refused), no userinfo (a user@ part), no port but 443, no
//     character outside ASCII (checked before lowercasing, so a Kelvin sign is not a k), and no
//     IP literal in any notation (dotted, hex, octal, a bare integer, IPv6): a host whose last
//     label is numeric is refused, in `hosts` and in the URL alike.
//   - The caller passes a whole URL and this module only validates it: it never builds one from
//     parts. Build URLs from constants and validated ids, never from a Sheet cell, a setting or
//     an RPC parameter taken as a whole.
//   - Redirects are never followed (followRedirects false): a 3xx is a non-2xx answer, so a
//     redirect cannot carry the request, or its credential, to a host that was not checked.
//   - Certificate validation is never disabled; HTTP errors are muted so the status can be read.
//   - Header names must be HTTP tokens; a header value or a contentType with a control character
//     (CR and LF included; a tab is allowed in a value) is refused before any request.
//   - A non-2xx answer, a transport failure, a body over the size cap and a body that is not JSON
//     (fetchJson) throw ApiError("error") with a fixed sentence. The status and a redacted,
//     length-capped excerpt of the body go to console.error only, with the host, never the path
//     or query (they can hold a token), and never the headers. The WHOLE text is redacted before
//     it is cut, and every log line masks the values of this call's own headers (and the part
//     after a scheme word such as Bearer, each of 6 characters or more, in their encoded forms
//     too) even when no `secrets` is given: a service that echoes its credential is common.
//
// The manifest must list the same hosts in urlFetchWhitelist (each as "https:" + two slashes +
// host + "/") and declare the script.external_request scope; the manifestScopes contract checks
// both. The whitelist is the platform's own check and this module is the kit's: keep them equal.

import { ApiError } from "./envelope";
import { REDACT_ENCODED_MIN, redactSecrets, redactTokens } from "./secrets";

/** A URL refused before any request was made. */
export const FETCH_REFUSED_MESSAGE = "The app tried to call an address it is not allowed to call.";
/** A transport failure or a non-2xx answer (a redirect included). */
export const FETCH_FAILED_MESSAGE = "An external service did not answer as expected. Try again later.";
/** A body over the size cap. */
export const FETCH_TOO_LARGE_MESSAGE = "An external service sent an answer that is too large.";
/** fetchJson of a body that is not JSON. */
export const FETCH_BAD_ANSWER_MESSAGE = "An external service sent an answer that could not be read.";
/** Default cap on a response body, in bytes. */
export const FETCH_MAX_BYTES = 1024 * 1024;
/** Hard ceiling for any cap (UrlFetchApp itself stops at 50 MB). */
export const FETCH_MAX_BYTES_CEILING = 50 * 1024 * 1024;
/** Longest body excerpt written to the log. */
export const FETCH_LOG_EXCERPT = 300;
/** Longest URL accepted. */
export const FETCH_URL_MAX = 2048;

const HOST_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// A URL reader takes a host whose last label is a number (decimal, octal with a leading 0, or hex
// with 0x) as an IPv4 address in some notation, so such a host is never a name.
const NUMERIC_LABEL = /^(?:0x[0-9a-f]*|[0-9]+)$/i;
// An HTTP header name (RFC 9110 token). The backtick is written as \x60.
const HEADER_NAME = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
// A control character in a header value or content type (a tab is allowed in a value).
const HEADER_VALUE_BAD = /[\u0000-\u0008\u000a-\u001f\u007f]/;

/** True for a host that is an IP literal in any notation: a numeric last label, or an IPv6 form. */
export function isIpLiteralHost(host: string): boolean {
  const h = String(host);
  if (h.indexOf(":") >= 0 || h.indexOf("[") >= 0) return true;
  const labels = h.split(".");
  return NUMERIC_LABEL.test(labels[labels.length - 1] ?? "");
}
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type FetchMethod = (typeof METHODS)[number];

export interface FetchConfig {
  /** Exact host names the app may call, such as "api.example.org". No wildcard, no port. */
  hosts: string[];
  /** Applied to a body excerpt before it is logged (createSecrets(...)); redactTokens always is. */
  secrets?: { redact(text: string): string };
  /** Cap on a response body in bytes. Default FETCH_MAX_BYTES. */
  maxBytes?: number;
}

export interface FetchOptions {
  /** Default "get". */
  method?: FetchMethod;
  /** Passed through as given; never logged. A value with a line break is refused. */
  headers?: Record<string, string>;
  /** A string is sent as is; an object is sent as JSON (contentType application/json). */
  payload?: string | Record<string, unknown> | unknown[];
  contentType?: string;
  /** A lower (or higher, up to FETCH_MAX_BYTES_CEILING) cap for this call, in bytes. */
  maxBytes?: number;
}

export interface Fetch {
  /** The parsed JSON body of a 2xx answer (null for an empty body). */
  fetchJson<T = unknown>(url: string, opts?: FetchOptions): T;
  /** The text body of a 2xx answer. */
  fetchText(url: string, opts?: FetchOptions): string;
}

/** The params sent to UrlFetchApp.fetch. followRedirects and the certificate check are fixed. */
export interface FetchParams {
  method: FetchMethod;
  headers: Record<string, string>;
  payload?: string;
  contentType?: string;
  followRedirects: false;
  muteHttpExceptions: true;
  validateHttpsCertificates: true;
}

interface HttpResponse {
  getResponseCode(): number;
  getContent?(): number[] | Uint8Array;
  getContentText(): string;
}

/**
 * The host of a URL this module may call, or the reason it is refused. Exported for
 * tests and for an app that wants to check a URL constant at startup.
 */
export function checkFetchUrl(url: unknown, hosts: readonly string[]): { ok: true; host: string } | { ok: false; reason: string } {
  if (typeof url !== "string") return { ok: false, reason: "not-a-string" };
  if (url.length > FETCH_URL_MAX) return { ok: false, reason: "too-long" };
  // Whitespace, control characters and backslashes are parsed differently by different URL
  // readers (a backslash is a slash to some), so none is accepted anywhere in the URL.
  if (/[\s\u0000-\u001f\u007f\\]/.test(url)) return { ok: false, reason: "bad-character" };
  const m = /^https:[/][/]([^/?#]*)([/?#].*)?$/.exec(url);
  if (!m) return { ok: false, reason: "not-https" };
  const authority = m[1];
  const rest = m[2] ?? "";
  if (authority.indexOf("@") >= 0) return { ok: false, reason: "userinfo" };
  if (authority.charAt(0) === "[") return { ok: false, reason: "ip-literal" };
  // Before lowercasing: toLowerCase maps some non-ASCII letters (a Kelvin sign) onto ASCII ones.
  if (/[^\x21-\x7e]/.test(authority)) return { ok: false, reason: "bad-host" };
  let host = authority;
  const colon = authority.lastIndexOf(":");
  if (colon >= 0) {
    if (authority.slice(colon + 1) !== "443") return { ok: false, reason: "port" };
    host = authority.slice(0, colon);
  }
  host = host.toLowerCase();
  if (!HOST_SHAPE.test(host)) return { ok: false, reason: "bad-host" };
  if (isIpLiteralHost(host)) return { ok: false, reason: "ip-literal" };
  if (hosts.indexOf(host) < 0) return { ok: false, reason: "host-not-allowed" };
  // urlFetchWhitelist entries end in a slash after the host, so a URL must have a path.
  if (rest.charAt(0) !== "/") return { ok: false, reason: "no-path" };
  return { ok: true, host };
}

function capOf(n: unknown, fallback: number): number {
  if (n === undefined) return fallback;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > FETCH_MAX_BYTES_CEILING) {
    throw new TypeError("createFetch: maxBytes must be a whole number from 1 to " + FETCH_MAX_BYTES_CEILING);
  }
  return n;
}

export function createFetch(config: FetchConfig): Fetch {
  if (!config || !Array.isArray(config.hosts) || config.hosts.length === 0) {
    throw new TypeError("createFetch needs { hosts: string[] } with at least one host");
  }
  const hosts: string[] = [];
  for (const h of config.hosts) {
    if (typeof h !== "string" || /[^\x21-\x7e]/.test(h) || !HOST_SHAPE.test(h) || isIpLiteralHost(h)) {
      throw new TypeError(
        "createFetch: each host must be an exact lowercase ASCII host name such as api.example.org (no scheme, port, path, wildcard or IP address)",
      );
    }
    hosts.push(h);
  }
  const defaultCap = capOf(config.maxBytes, FETCH_MAX_BYTES);
  const secrets = config.secrets;

  /**
   * The text as a log line may hold it: this call's header values (mask) and every declared
   * secret and token shape redacted over the WHOLE text, and only then cut, so a secret that
   * straddles the cut is never half-logged.
   */
  function excerpt(text: string, mask: readonly string[]): string {
    let t = String(text);
    try {
      t = redactSecrets(t, mask);
      if (secrets) t = secrets.redact(t);
      t = redactTokens(t);
    } catch {
      return "[excerpt withheld: redaction failed]";
    }
    return t.slice(0, FETCH_LOG_EXCERPT);
  }

  /** The values a log line must not hold: each header value, and the part after a scheme word. */
  function maskOf(headers: Record<string, string>): string[] {
    const out: string[] = [];
    for (const k of Object.keys(headers)) {
      const v = headers[k]!.trim();
      if (v.length >= REDACT_ENCODED_MIN) out.push(v);
      const m = /^[A-Za-z][A-Za-z0-9._-]*\s+(\S[\s\S]*)$/.exec(v);
      if (m && m[1]!.trim().length >= REDACT_ENCODED_MIN) out.push(m[1]!.trim());
    }
    return out;
  }

  function log(line: Record<string, unknown>): void {
    try {
      console.error(JSON.stringify(line));
    } catch {
      // logging is best-effort
    }
  }

  function paramsOf(opts: FetchOptions): FetchParams {
    const method = opts.method ?? "get";
    if ((METHODS as readonly string[]).indexOf(method) < 0) throw new TypeError("fetch: method must be one of " + METHODS.join(", "));
    const headers: Record<string, string> = {};
    if (opts.headers) {
      for (const k of Object.keys(opts.headers)) {
        const v = opts.headers[k];
        if (typeof v !== "string" || HEADER_VALUE_BAD.test(v) || !HEADER_NAME.test(k)) refuse("header");
        headers[k] = v;
      }
    }
    const params: FetchParams = { method, headers, followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true };
    if (opts.payload !== undefined) {
      if (typeof opts.payload === "string") {
        params.payload = opts.payload;
      } else {
        params.payload = JSON.stringify(opts.payload);
        params.contentType = "application/json";
      }
    }
    if (opts.contentType !== undefined) {
      if (typeof opts.contentType !== "string" || HEADER_VALUE_BAD.test(opts.contentType)) refuse("content-type");
      params.contentType = opts.contentType;
    }
    return params;
  }

  function refuse(reason: string): never {
    log({ fetch: "refused", reason });
    throw new ApiError("error", FETCH_REFUSED_MESSAGE);
  }

  function call(url: string, opts: FetchOptions, json: boolean): unknown {
    const checked = checkFetchUrl(url, hosts);
    if (!checked.ok) refuse(checked.reason);
    const host = checked.host;
    const cap = capOf(opts.maxBytes, defaultCap);
    const params = paramsOf(opts);
    const mask = maskOf(params.headers);
    let resp: HttpResponse;
    try {
      resp = UrlFetchApp.fetch(url, params as GoogleAppsScript.URL_Fetch.URLFetchRequestOptions) as unknown as HttpResponse;
    } catch (e) {
      // The service's text can quote the URL, query and all: it is redacted and logged, not shown.
      const msg = e instanceof Error ? e.message : String(e);
      log({ fetch: "failed", host, error: excerpt(msg.split(url).join("[url]"), mask) });
      throw new ApiError("error", FETCH_FAILED_MESSAGE);
    }
    const status = resp.getResponseCode();
    const bytes = typeof resp.getContent === "function" ? resp.getContent().length : null;
    if (bytes !== null && bytes > cap) {
      log({ fetch: "too-large", host, status, bytes, cap });
      throw new ApiError("error", FETCH_TOO_LARGE_MESSAGE);
    }
    const text = resp.getContentText();
    if (bytes === null && text.length > cap) {
      log({ fetch: "too-large", host, status, chars: text.length, cap });
      throw new ApiError("error", FETCH_TOO_LARGE_MESSAGE);
    }
    if (!(status >= 200 && status < 300)) {
      log({ fetch: "status", host, status, excerpt: excerpt(text, mask) });
      throw new ApiError("error", FETCH_FAILED_MESSAGE);
    }
    if (!json) return text;
    if (text.trim() === "") return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      log({ fetch: "not-json", host, excerpt: excerpt(text, mask) });
      throw new ApiError("error", FETCH_BAD_ANSWER_MESSAGE);
    }
  }

  return {
    fetchText(url: string, opts?: FetchOptions): string {
      return call(url, opts ?? {}, false) as string;
    },
    fetchJson<T = unknown>(url: string, opts?: FetchOptions): T {
      const o: FetchOptions = { ...(opts ?? {}) };
      const headers = { ...(o.headers ?? {}) };
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "accept")) headers.Accept = "application/json";
      o.headers = headers;
      return call(url, o, true) as T;
    },
  };
}
