// Extracted from the author's production Apps Script apps; adapted.
// The served pages: the app shell from the "index" template, allow-listed partials, and a
// standalone card page (denial or info) with its own inline CSS and no external assets.
// Colours come from CSS system colours (keywords, not literals), so the page follows the
// viewer's light or dark scheme; --accent is the one token.

import { isPlainAddress } from "./address";

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderIndexSpec {
  title: string;
  /** Already escaped by inlineBootJson, or "" when the client should fetch the bootstrap. */
  bootJson: string;
  /**
   * An https URL for the tab icon, applied with HtmlOutput.setFaviconUrl. Anything that is not an
   * https URL throws. This is the option that works in a deployed web app.
   */
  faviconUrl?: string;
  /**
   * A data:image URL written into the template, for the dev server only. In a deployed web app the
   * page runs in an iframe and the tab belongs to Google's outer page, so a link rel=icon inside
   * it has no effect there: use faviconUrl.
   */
  faviconDataUrl?: string;
}

/** The app shell: the "index" template, evaluated with the boot payload. */
export function renderIndex(spec: RenderIndexSpec): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("index") as GoogleAppsScript.HTML.HtmlTemplate &
    Record<string, unknown>;
  // The slot is raw, so refuse anything that is not already inert (see inlineBootJson).
  // A '/' must be escaped too (inlineBootJson writes it after a backslash), so the middlebox that
  // strips comments has no double slash to misread in a URL.
  if (/[<>&'\x60\u2028\u2029]|(^|[^\\])\//.test(spec.bootJson)) {
    throw new Error("renderIndex: bootJson must come from inlineBootJson");
  }
  if (spec.faviconUrl !== undefined && !/^https:\/\/[^\s"'<>\\]+$/i.test(spec.faviconUrl)) {
    throw new Error("renderIndex: faviconUrl must be an https URL");
  }
  template.bootJson = spec.bootJson;
  // Only a data:image/ URL without quotes or angle brackets reaches the template.
  const fav = spec.faviconDataUrl ?? "";
  template.faviconDataUrl = /^data:image\/[a-z0-9.+-]+[;,][^"'<>\s]*$/i.test(fav) ? fav : "";
  const out = template
    .evaluate()
    .setTitle(spec.title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  if (spec.faviconUrl !== undefined) out.setFaviconUrl(spec.faviconUrl);
  return out;
}

/** The partials a template may include by default: the bundled styles and client script. */
export const DEFAULT_INCLUDES: readonly string[] = ["styles", "js_app"];

/** An include() that serves only the named partials; anything else throws. */
export function createInclude(allowed: readonly string[]): (filename: string) => string {
  return function include(filename: string): string {
    if (!allowed.includes(filename)) throw new Error("Not an includable file: " + filename);
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  };
}

/** Used from index template scriptlets. */
export const include = createInclude(DEFAULT_INCLUDES);

export interface CardPageSpec {
  /** Browser tab title. */
  title: string;
  heading: string;
  /** Small label above the heading. Defaults to the title. */
  eyebrow?: string;
  /** Plain-text paragraphs. Escaped here. */
  lines: string[];
  /** One optional link-button. href and label are escaped here. */
  action?: { href: string; label: string };
  /** More link-buttons after `action` (at most 3 links in all). Same rules; an unsafe href is dropped. */
  actions?: { href: string; label: string }[];
  /**
   * An optional brand mark above the eyebrow: a name from the fixed set (an unknown name draws
   * nothing), drawn by the kit as inline SVG. `accent` is a hex colour (#rgb or #rrggbb) for the
   * mark only; anything else falls back to the page's accent. No app markup reaches the page.
   */
  mark?: { shape: CardMarkShape; accent?: string };
}

/** The marks cardPage can draw. Shapes differ, so the mark never relies on colour alone. */
export type CardMarkShape = "dot" | "ring" | "square" | "diamond";

const MARK_SVG: Record<CardMarkShape, string> = {
  dot: '<circle cx="12" cy="12" r="8" fill="currentColor"/>',
  ring: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="3"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/>',
  diamond: '<path d="M12 3 21 12 12 21 3 12Z" fill="currentColor"/>',
};

function markHtml(mark: CardPageSpec["mark"]): string {
  if (!mark || typeof mark.shape !== "string" || !Object.prototype.hasOwnProperty.call(MARK_SVG, mark.shape)) return "";
  const accent = typeof mark.accent === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(mark.accent)
    ? ' style="color:' + mark.accent + '"'
    : "";
  return '<svg class="mark" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"' +
    accent + ">" + MARK_SVG[mark.shape] + "</svg>";
}

// A mailto action is allowed only for one plain address (isPlainAddress, and no "%" so the address
// cannot decode into a header break) and at most one "?subject=" of percent-encoded text whose
// decoded form has no control character. Any other parameter (cc, bcc, body), a second "?", "&" or
// "#", or a comma or semicolon (several recipients) is refused.
const SUBJECT_CHARS = /^[A-Za-z0-9._~!*'()%-]+$/;
function isSafeMailto(h: string): boolean {
  const rest = h.slice("mailto:".length);
  const q = rest.indexOf("?");
  const addr = q < 0 ? rest : rest.slice(0, q);
  if (!addr || addr.indexOf("%") >= 0 || addr !== addr.trim() || !isPlainAddress(addr)) return false;
  if (q < 0) return true;
  const query = rest.slice(q + 1);
  if (!/^subject=/i.test(query)) return false;
  const subject = query.slice("subject=".length);
  if (subject.length > 300 || !SUBJECT_CHARS.test(subject)) return false;
  try {
    return !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(decodeURIComponent(subject));
  } catch {
    return false;
  }
}

/**
 * Allow-list for an action link: https, http, a relative path, or a mailto to one plain address
 * (optionally with a "?subject="); nothing else.
 */
export function isSafeHref(href: string): boolean {
  const h = String(href).trim();
  if (/^https?:\/\//i.test(h)) return true;
  if (/^mailto:/i.test(h)) return isSafeMailto(h);
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return false;
  // Browsers read a backslash as a slash, so "/\host" and "\\host" are protocol-relative too.
  if (h.indexOf("\\") >= 0) return false;
  return !/^[/\\]{2}/.test(h) && !/[\u0000-\u001f]/.test(h);
}

/** A simple standalone page. Every field is escaped; there is no raw-HTML slot. */
export function cardPage(spec: CardPageSpec): GoogleAppsScript.HTML.HtmlOutput {
  const body = spec.lines.map((l) => "<p>" + escapeHtml(l) + "</p>").join("");
  const links = [spec.action, ...(spec.actions ?? [])]
    .filter((a): a is { href: string; label: string } => !!a && isSafeHref(a.href))
    .slice(0, 3)
    .map((a) => '<a class="btn" target="_top" href="' + escapeHtml(a.href.trim()) + '">' + escapeHtml(a.label) + "</a>");
  const action = links.length ? '<div class="actions">' + links.join("") + "</div>" : "";
  const css = [
    ":root{color-scheme:light dark;--accent:LinkText}",
    "*{box-sizing:border-box}",
    "html,body{margin:0;min-height:100%}",
    "body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;",
    "background:Canvas;color:CanvasText;font:14px/1.6 system-ui,sans-serif}",
    ".card{max-width:440px;width:100%;background:Canvas;",
    "border:1px solid color-mix(in srgb,CanvasText 12%,transparent);",
    "border-radius:12px;padding:32px}",
    ".eyebrow{font-size:12px;letter-spacing:.04em;text-transform:uppercase;",
    "color:color-mix(in srgb,CanvasText 65%,transparent)}",
    "h1{margin:8px 0 16px;font-size:20px;line-height:1.3}",
    "p{margin:0 0 8px;color:color-mix(in srgb,CanvasText 65%,transparent)}",
    ".actions{margin-top:24px}",
    ".mark{display:block;margin:0 0 12px;color:var(--accent)}",
    ".btn+.btn{margin-left:8px}",
    ".btn{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;",
    "border-radius:8px;background:CanvasText;color:Canvas;text-decoration:none}",
    "a{color:var(--accent)}.btn{color:Canvas}",
    "a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}",
  ].join("");
  const markup = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<base target="_top"><title>' + escapeHtml(spec.title) + "</title>",
    "<style>" + css + "</style></head><body><main class=\"card\">",
    markHtml(spec.mark),
    '<div class="eyebrow">' + escapeHtml(spec.eyebrow ?? spec.title) + "</div>",
    "<h1>" + escapeHtml(spec.heading) + "</h1>",
    body,
    action,
    "</main></body></html>",
  ].join("");
  return HtmlService.createHtmlOutput(markup)
    .setTitle(spec.title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
