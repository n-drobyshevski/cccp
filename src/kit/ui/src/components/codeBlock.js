import { html } from "@gas-kit/client/html.js";
import { copyButton } from "./copyButton.js";

/**
 * @component codeBlock
 * @title Code Block
 * @category Data display
 * @summary A monospace block for code, a query or a log, with an optional caption and a copy button.
 * @param {{code: string, lang?: string, caption?: string, wrap?: boolean, copy?: boolean, k?: string}} p
 * `code` is shown verbatim (no highlighting, never parsed as markup). `lang` is a plain label such as "json", shown in the header and set as a data attribute. `caption` names the block and is its accessible name. `wrap` wraps long lines instead of scrolling sideways. `copy` (default true) adds a copy button; it needs the copyButton island registered. `k` goes to `data-k` on the pre.
 * @emits none
 * @states default, captioned, wrapped, no-copy, empty
 * @a11y The pre has tabindex 0 so a keyboard user can scroll a long or wide block, and role region with the caption (or the language, or "Code") as its name. The caption and language are visible text. The copy button announces the result in a polite live region.
 * @example default: codeBlock({ code: "npm install acme-kit\nnpm run dev", k: "code-install" })
 * @example captioned: codeBlock({ code: "{\n  \"name\": \"Acme\"\n}", lang: "json", caption: "Example config", k: "code-config" })
 * @example wrapped: codeBlock({ code: "SELECT id, owner, status FROM items WHERE owner = 'dana.reyes@example.org' AND status = 'open' ORDER BY id", lang: "sql", wrap: true, k: "code-sql" })
 * @example no-copy: codeBlock({ code: "read only", copy: false })
 * @example empty: codeBlock({ code: "", caption: "Nothing yet" })
 */
export function codeBlock(p) {
  const q = p || { code: "" };
  const code = q.code != null ? String(q.code) : "";
  const lang = q.lang != null && q.lang !== "" ? String(q.lang) : "";
  const caption = q.caption != null && q.caption !== "" ? String(q.caption) : "";
  const name = caption || lang || "Code";
  const withCopy = q.copy !== false && code !== "";
  const k = q.k != null && q.k !== "" ? String(q.k) : null;
  const head = caption || lang || withCopy
    ? html`<div class="gk-codeBlock__head"><figcaption class="gk-codeBlock__caption">${caption}</figcaption><span class="gk-codeBlock__lang">${lang}</span>${withCopy ? copyButton({ text: code, size: "icon", variant: "ghost", label: "Copy " + (caption || lang || "code"), k: k ? k + "-copy" : undefined }) : ""}</div>`
    : "";
  return html`<figure class="gk-codeBlock${q.wrap === true ? " is-wrap" : ""}${code === "" ? " is-empty" : ""}">${head}<pre class="gk-codeBlock__pre" tabindex="0" role="region" aria-label="${name}" data-lang="${lang || null}" data-k="${k}"><code>${code}</code></pre></figure>`;
}
