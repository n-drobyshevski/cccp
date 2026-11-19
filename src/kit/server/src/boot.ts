// Extracted from the author's production Apps Script apps; adapted.
// The bootstrap payload rendered into the served page, and its shape.
//
// The escaping is the security boundary. The JSON lands inside a script block in a template and
// carries user-controlled strings. Escaping < > and & makes a closing-tag or comment breakout
// impossible. The slash, the apostrophe and the backtick are escaped as well so a proxy that
// strips comments from served pages has nothing to misread. U+2028 and U+2029 are escaped
// because older engines treat them as line terminators. Every replacement is a legal JSON
// escape, so JSON.parse reads the original value back unchanged.

const UNSAFE = /[<>&/'\x60\u2028\u2029]/g;

/** JSON that is inert inside an HTML script block. undefined yields "". */
export function inlineBootJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return "";
  return json.replace(UNSAFE, (c) =>
    c === "/" ? "\\/" : "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/**
 * Run an app's bootstrap inside doGet and render its envelope. Only an {ok:true} envelope is
 * inlined; a throw or a failed envelope renders "" and the client falls back to the RPC.
 */
export function inlineBootEnvelope(bootstrap: () => { ok: boolean }): string {
  try {
    const res = bootstrap();
    if (!res || res.ok !== true) return "";
    return inlineBootJson(res);
  } catch {
    return "";
  }
}

/**
 * Inline the bootstrap only when it is already warm. peekFn returns a cached payload (a cache
 * peek: it must never compute). A value renders as the envelope {ok:true, data}, escaped exactly
 * as inlineBootEnvelope escapes; undefined, null or a throw renders "" and the client falls back
 * to the RPC, so a cold cache never slows the page. Like inlineBootEnvelope it logs nothing.
 */
export function inlineIfWarm(peekFn: () => unknown | undefined): string {
  try {
    const data = peekFn();
    if (data === undefined || data === null) return "";
    return inlineBootJson({ ok: true, data });
  } catch {
    return "";
  }
}

export interface Boot<C, L> {
  /** Cached and viewer-free. */
  core: C;
  /** Never cached: viewer, role, email, serviceUrl, today and buildId. */
  live: L;
}

/** The payload shape: the cached core beside the live part. */
export function splitBoot<C, L>(parts: { core: C; live: L }): Boot<C, L> {
  return { core: parts.core, live: parts.live };
}
