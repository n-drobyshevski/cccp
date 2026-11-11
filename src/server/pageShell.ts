// The card shell for the standalone page doGet serves INSTEAD of the app: the denied page.
//
// Derived from sidekick gas_hub/src/server/pageShell.ts at commit 77bcf22 (see VENDOR.md): the
// mark is CCCP's four dots, and the entry-screen use is gone. The page carries its own inline
// CSS rather than the app stylesheet, so someone being turned away is not sent the design
// system. Colour literals are fine here: this is server markup, not the client bundle, and the
// values are the light-theme tokens resolved.

// Four dots in a square, one per pillar. Decorative: aria-hidden, never labelled, because it
// sits beside the wordmark.
const MARK_DOTS: Array<[number, number]> = [[7, 7], [17, 7], [7, 17], [17, 17]];

function brandMarkSvg(size: number): string {
  const dots = MARK_DOTS.map(
    (d) => '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="3.6" fill="#0a0a0a"/>',
  ).join("");
  return (
    '<svg class="brand-mark" viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" focusable="false" aria-hidden="true">' + dots + "</svg>"
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CardPageSpec {
  /** Browser tab title. */
  title: string;
  /** The wordmark beside the glyph, above the heading. */
  eyebrow: string;
  /** The one-line statement the page exists to make. */
  heading: string;
  /**
   * Body paragraphs, as HTML FRAGMENTS — `<strong>` and friends are allowed, so anything
   * originating outside this module (an email address, a URL) must already have been through
   * escapeHtml(). Same contract for `actions`.
   */
  paragraphs: string[];
  /** Optional action row: a primary link-button and/or a secondary text link. */
  actions?: string;
}

/** A secondary text link, beside or below the primary action. */
export function secondaryAction(href: string, label: string): string {
  return (
    '<a class="alt" target="_top" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>"
  );
}

export function cardPage(spec: CardPageSpec): string {
  const body = spec.paragraphs.map((p) => "<p>" + p + "</p>").join("");
  const actions = spec.actions ? '<div class="actions">' + spec.actions + "</div>" : "";
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    // Every link on these pages has to break out of the HtmlService sandbox iframe; the app's
    // own index.html carries the same base tag for the same reason.
    '<base target="_top">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + escapeHtml(spec.title) + "</title><style>",
    "*{box-sizing:border-box}",
    // --surface / --ink, and the same --font stack tokens.css:254 carries.
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
    "background:#f8f8fa;color:#171717;",
    "font-family:-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',Roboto,'Helvetica Neue',sans-serif}",
    // --page on --hairline at --radius-xl.
    ".card{max-width:32rem;margin:24px;padding:32px;background:#ffffff;border:1px solid #e6e6e9;",
    "border-radius:14px;box-shadow:0 1px 2px rgba(10,10,10,.06)}",
    ".lockup{display:flex;align-items:center;gap:8px;margin:0 0 16px}",
    // Mirrors .appbar-name in base.css (600 / --fs-lead 16px / -0.02em / --ink) so the
    // wordmark is the same object here as in the header, not a near-miss of it.
    ".lockup span{font-weight:600;font-size:1rem;letter-spacing:-0.02em;color:#171717;",
    "white-space:nowrap}",
    ".brand-mark{display:block;flex:0 0 auto}",
    "h1{font-size:20px;line-height:1.3;margin:0 0 12px;font-weight:650}",
    // --text-2, the same alpha the app's prose carries.
    "p{margin:0 0 8px;font-size:14px;line-height:1.6;color:rgba(0,0,0,.65)}",
    ".actions{margin-top:24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}",
    // Graphite, not the accent: the design keeps the accent for data, focus and links, and
    // fills the one committing action with --graphite / --on-graphite.
    ".btn{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;",
    "border-radius:8px;background:#0a0a0a;color:#fafafa;font-size:14px;font-weight:500;",
    "text-decoration:none}",
    ".btn:hover{background:#27272a}",
    // --accent-text. NOT --accent: this page is plain text on white, where #ffcb13 is 1.52:1.
    // pages are the product's front door and must read as this product.
    "a{color:#7c4a0a}",
    // Never remove: CLAUDE.md names the focus-ring rules load-bearing, and these pages are
    // reachable by keyboard only.
    "a:focus-visible{outline:2px solid #7c4a0a;outline-offset:2px;border-radius:4px}",
    "</style></head><body><main class=\"card\">",
    // The same lockup as the app header — mark then wordmark — so the door and the room
    // behind it are recognisably one product.
    '<div class="lockup">' + brandMarkSvg(22) +
      "<span>" + escapeHtml(spec.eyebrow) + "</span></div>",
    "<h1>" + escapeHtml(spec.heading) + "</h1>",
    body,
    actions,
    "</main></body></html>",
  ].join("");
}
