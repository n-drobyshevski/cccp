// Secrets: the credentials an app needs to call another service (an API key, a client secret, a
// static bearer token), read on the server only, from a declared list of keys.
//
//   const secrets = createSecrets({ keys: ["ACME_API_KEY"], props: { get: getProp } });
//   const key = secrets.get("ACME_API_KEY");          // throws ApiError when unset or undeclared
//   secrets.presence("ACME_API_KEY");                 // { set: true, length: 40 }, for diagnostics
//   const run = createRun({ ..., redact: secrets.redact });
//   const log = createErrorLog(props, { redact: secrets.redact });
//
// A SECRET VALUE IS NEVER LOGGED, NEVER CACHED AND NEVER RETURNED. Read it with get() at the
// moment it is sent (a header of a fetch) and nowhere else: never put it in a cache, a Script
// Property other than its own, an RPC result, the boot payload, an audit detail or a log line.
// presence() is what a diagnostic shows: whether it is set and how long it is, never a character
// of it (not the first four, not the last two). get() reads the store on every call; nothing is
// memoised, so a rotated value takes effect on the next call.
//
// SCRIPT PROPERTIES ARE NOT A SECRET STORE. Every editor of the script project can read them (and
// so can anyone who can deploy or run a version of it), there is no access control on a single
// key and no record of who read one. They suit a low-value credential the app's editors may hold
// anyway. A high-value secret (one that reaches other people's data, or that the editors must not
// see) belongs in a secret manager, fetched per execution and held in a local variable only.
//
// REDACTION. redact(text) replaces every declared secret's current value with SECRET_MARKER, and
// also its encoded forms when the value is at least REDACT_ENCODED_MIN characters long: the value
// and its base64 forms (standard and URL-safe, padded or not, at each of the three byte
// alignments, so a value inside a Basic credential is caught), with every character other than a
// letter or digit matched in any mix of the ways services echo it: as is, percent-encoded (strict
// RFC 3986 or not, either hex case, a space as +) once or twice, JSON-escaped (a backslash before
// it, as in a slash written as a backslash and a slash, or a \u escape), or an HTML entity
// (numeric in decimal or hex, or named). Then it applies redactTokens(). Pass it as
// the redact option of createRun and createErrorLog. An app that declares no secret still passes
// redactTokens there: it masks bearer tokens, OAuth access tokens, API keys and the common
// credential query and JSON fields whatever produced them. Redaction is a net under a mistake,
// not a licence to put a secret in a message.

import { ApiError } from "./envelope";

/** What a redacted value is replaced with. */
export const SECRET_MARKER = "[redacted]";
/** get() of a key the app did not declare (a programming error). */
export const SECRET_UNDECLARED_MESSAGE = "A secret was requested that this app does not declare.";
/** get() of a declared key with no value in the store. */
export const SECRET_UNSET_MESSAGE = "A secret this app needs is not set. Ask whoever runs this app to set it.";
/** redact() could not read a secret's current value, so it withholds the whole text. */
export const SECRET_REDACT_WITHHELD = "[text withheld: a secret could not be read to redact it]";
/** Shortest value whose encoded forms are redacted too (a shorter one would mask too much text). */
export const REDACT_ENCODED_MIN = 6;

const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

/** Where the values live: a Script Properties reader, usually the app's getProp. */
export interface SecretProps {
  get(key: string): string | null;
}

export interface SecretsOptions {
  /** Every key the app may read as a secret. Anything else is refused by get(). */
  keys: string[];
  props: SecretProps;
}

/** What a diagnostic may show of a secret: whether it is set and its length, nothing else. */
export interface SecretPresence {
  set: boolean;
  length: number;
}

export interface Secrets {
  /** The value. Throws ApiError("error") when the key is undeclared or unset; the message never names the value. */
  get(key: string): string;
  /** Set and length only. An undeclared key, an unset key or a failed read is { set: false, length: 0 }. */
  presence(key: string): SecretPresence;
  /** The text with every declared secret (raw and encoded) and every token redactTokens knows replaced. */
  redact(text: string): string;
}

export function createSecrets(opts: SecretsOptions): Secrets {
  if (!opts || !Array.isArray(opts.keys) || typeof opts.props?.get !== "function") {
    throw new TypeError("createSecrets needs { keys: string[], props: { get(key) } }");
  }
  for (const k of opts.keys) {
    if (typeof k !== "string" || !KEY_SHAPE.test(k)) throw new TypeError("createSecrets: a secret key must be a property name such as ACME_API_KEY");
  }
  const keys = Array.from(new Set(opts.keys));
  const declared = new Set(keys);
  const props = opts.props;

  /** The stored value, or null when unset or empty. A failed read throws. */
  function read(key: string): string | null {
    const v = props.get(key);
    return typeof v === "string" && v.length > 0 ? v : null;
  }

  return {
    get(key: string): string {
      if (!declared.has(key)) throw new ApiError("error", SECRET_UNDECLARED_MESSAGE);
      let v: string | null;
      try {
        v = read(key);
      } catch {
        // The store's own error text could name the key's neighbours or worse: use the sentence.
        throw new ApiError("error", SECRET_UNSET_MESSAGE);
      }
      if (v === null) throw new ApiError("error", SECRET_UNSET_MESSAGE);
      return v;
    },
    presence(key: string): SecretPresence {
      if (!declared.has(key)) return { set: false, length: 0 };
      try {
        const v = read(key);
        return v === null ? { set: false, length: 0 } : { set: true, length: v.length };
      } catch {
        return { set: false, length: 0 };
      }
    },
    redact(text: string): string {
      const values: string[] = [];
      try {
        for (const k of keys) {
          const v = read(k);
          if (v !== null) values.push(v);
        }
      } catch {
        return SECRET_REDACT_WITHHELD;
      }
      return redactTokens(redactSecrets(text, values));
    },
  };
}

/**
 * The text with every value, and (for a value of at least REDACT_ENCODED_MIN characters) its
 * encoded forms, replaced with SECRET_MARKER. An encoded form is the value or one of its base64
 * forms with each character other than a letter or digit written in any of the ways a service
 * echoes it, mixed freely: as is, percent-encoded once or twice (either hex case; a space also as
 * +), JSON-escaped (a backslash before it, or a \u escape) or as an HTML entity (numeric in
 * decimal or hex, or named). Longer forms go first, so a value that contains another is masked
 * whole. Empty and non-string values are ignored. Linear in the text. Pure.
 */
export function redactSecrets(text: string, values: readonly string[]): string {
  let out = typeof text === "string" ? text : String(text);
  const plain = new Set<string>();
  const encoded = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string" || !v) continue;
    if (v.length < REDACT_ENCODED_MIN) {
      plain.add(v);
      continue;
    }
    encoded.add(v);
    for (const f of base64Forms(v)) if (f.length >= REDACT_ENCODED_MIN) encoded.add(f);
  }
  const ordered = Array.from(encoded).sort((a, b) => b.length - a.length);
  for (const f of ordered) out = out.replace(new RegExp(anyEncoding(f), "g"), SECRET_MARKER);
  for (const f of Array.from(plain).sort((a, b) => b.length - a.length)) if (out.indexOf(f) >= 0) out = out.split(f).join(SECRET_MARKER);
  return out;
}

// Token shapes masked whatever produced them. Each keeps its label and masks the value. Every
// pattern is linear: no nested quantifier, and the alternatives of a repeated group are disjoint.
const TOKEN_RULES: { re: RegExp; to: string }[] = [
  // Authorization header values: "Bearer abc...", "Basic dXNlcjpwYXNz", "Token abc...", "ApiKey abc...".
  { re: /\b(Bearer|Basic|Token|ApiKey)(\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, to: "$1$2" + SECRET_MARKER },
  // Google OAuth access tokens.
  { re: /\bya29\.[A-Za-z0-9._~+/-]+/g, to: SECRET_MARKER },
  // Google API keys.
  { re: /\bAIza[A-Za-z0-9_-]{20,}/g, to: SECRET_MARKER },
  // Query values: ?key=..., &token=..., &secret=..., &auth=...
  {
    re: /([?&;](?:key|token|access_token|sig|signature|secret|auth|x-api-key|api_key|apikey|password)=)[^&#\s"']+/gi,
    to: "$1" + SECRET_MARKER,
  },
];

// Credential fields in JSON, form bodies and headers: "access_token": "...", client_secret=...,
// X-Api-Key: ..., and the same inside a JSON string (an escaped quote around the name). A quoted
// value is consumed to its closing quote, backslash escapes included, so a value with a space or
// a comma in it is masked whole; an unclosed quote masks to the end of the text.
const FIELD_NAMES = "access_token|refresh_token|id_token|client_secret|api[_-]?key|apikey|x-api-key|password|passwd|secret|token|auth";
const FIELD_RE = new RegExp(
  "((?:\\\\?[\"'])?\\b(?:" + FIELD_NAMES + ")(?:\\\\?[\"'])?\\s*[:=]\\s*)" +
    "(\\\\\"(?:[^\\\\\"]|\\\\[^\"])*(?:\\\\\"|$)" + // \"...\" (inside a JSON string)
    "|\"(?:[^\"\\\\]|\\\\[\\s\\S])*(?:\"|$)" + // "..."
    "|'(?:[^'\\\\]|\\\\[\\s\\S])*(?:'|$)" + // '...'
    "|[^\"'&\\s,;}\\\\]+)", // a bare value
  "gi",
);

function maskField(_m: string, label: string, value: string): string {
  if (value.charAt(0) === "\\") return label + "\\\"" + SECRET_MARKER + "\\\"";
  const q = value.charAt(0);
  if (q === "\"" || q === "'") return label + q + SECRET_MARKER + q;
  return label + SECRET_MARKER;
}

/**
 * The text with bearer, basic, token and apikey credentials, ya29. OAuth tokens, AIza API keys,
 * credential JSON, header or form fields (access_token, refresh_token, id_token, client_secret,
 * api_key, api-key, apikey, x-api-key, password, passwd, secret, token, auth; also with escaped
 * quotes, and a quoted value whole) and key=, token=, access_token=, sig=, signature=, secret=,
 * auth=, x-api-key=, api_key=, apikey=, password= query values replaced with SECRET_MARKER.
 * Linear in the text. Pure; usable as the redact option of createRun and createErrorLog when an
 * app declares no secret.
 */
export function redactTokens(text: string): string {
  let out = typeof text === "string" ? text : String(text);
  for (const r of TOKEN_RULES) out = out.replace(r.re, r.to);
  return out.replace(FIELD_RE, maskField);
}

// ------------------------------------------------------------------ encodings (no Utilities)

const RE_SPECIAL = /[\\^$.*+?()[\]{}|/-]/g;
const reLiteral = (s: string): string => s.replace(RE_SPECIAL, "\\$&");
/** A hex number matched in either case, at least `width` digits (leading zeros optional beyond). */
function hexAny(n: number, width: number): string {
  const h = n.toString(16).toUpperCase();
  const pad = h.length < width ? "0".repeat(width - h.length) : "";
  return (pad + h).replace(/[A-F]/g, (d) => "[" + d + d.toLowerCase() + "]");
}
const NAMED: Record<string, string> = {
  "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "apos", "/": "sol", "+": "plus", "=": "equals", "!": "excl",
  "*": "ast", "(": "lpar", ")": "rpar", ":": "colon", "@": "commat", "%": "percnt", "#": "num", "$": "dollar",
  "?": "quest", " ": "nbsp", "-": "hyphen", "_": "lowbar", ".": "period", ",": "comma", ";": "semi",
};

/** A pattern for one character in any of the encodings redactSecrets knows. */
function charPattern(c: string): string {
  if (/^[A-Za-z0-9]$/.test(c)) return c;
  const code = c.codePointAt(0)!;
  const alts = [reLiteral(c)];
  // Percent-encoded (the UTF-8 bytes), once or twice; a space also as +.
  alts.push(utf8(c).map((b) => "%(?:25)?" + hexAny(b, 2)).join(""));
  if (c === " ") alts.push("\\+");
  // JSON: a backslash escape (\/ \" \\) and a \u escape (a surrogate pair above U+FFFF).
  alts.push("\\\\" + reLiteral(c));
  if (code <= 0xffff) alts.push("\\\\u" + hexAny(code, 4));
  else alts.push("\\\\u" + hexAny(c.charCodeAt(0), 4) + "\\\\u" + hexAny(c.charCodeAt(1), 4));
  // HTML: numeric entities in decimal and hex, and the named one.
  alts.push("&#0*" + code + ";", "&#[xX]0*" + hexAny(code, 1) + ";");
  if (NAMED[c]) alts.push("&" + NAMED[c] + ";");
  return "(?:" + alts.join("|") + ")";
}

/** The pattern of a form in any encoding, character by character. */
function anyEncoding(f: string): string {
  let out = "";
  for (const c of Array.from(f)) out += charPattern(c);
  return out;
}

/** The base64 forms of a value: standard and URL-safe, padded or not, at each byte alignment. */
function base64Forms(v: string): string[] {
  const out: string[] = [];
  const bytes = utf8(v);
  const whole = base64(bytes);
  out.push(whole, whole.replace(/=+$/, ""));
  // Inside a longer base64 run (a Basic credential "user:secret") the value starts at one of
  // three alignments; the characters that depend on its bytes alone are the same at each.
  for (let k = 0; k < 3; k++) {
    const pad = new Array<number>(k).fill(0);
    const enc = base64(pad.concat(bytes));
    const from = Math.ceil((8 * k) / 6);
    const to = Math.floor((8 * (k + bytes.length)) / 6);
    if (to > from) out.push(enc.slice(from, to));
  }
  for (const f of out.slice()) out.push(f.replace(/\+/g, "-").replace(/\//g, "_"));
  return out;
}

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}
