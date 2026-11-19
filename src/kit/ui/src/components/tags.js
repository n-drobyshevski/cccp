// Extracted from the author's production Apps Script apps; adapted.
// A list of small text tags, optionally removable, with a "+N" overflow.
import { html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";

const TONES = ["ok", "warn", "bad", "info", "none"];

/**
 * @param {unknown} t
 * @returns {{id: string, key: string, text: string, tone: string, tip: string|null}}
 */
function norm(t) {
  const o = t != null && typeof t === "object" ? /** @type {any} */ (t) : { text: t };
  const text = o.text != null ? String(o.text) : "";
  return {
    id: o.id != null ? String(o.id) : text,
    key: "",
    text,
    tone: TONES.indexOf(o.tone) >= 0 ? o.tone : "none",
    tip: o.tip != null && o.tip !== "" ? String(o.tip) : null,
  };
}

/**
 * @component tags
 * @title Tags
 * @category Data display
 * @summary A list of text tags, optionally removable, collapsing extra tags into "+N".
 * @param {{items: Array<string|{text: string, id?: string, tone?: "ok"|"warn"|"bad"|"info"|"none", tip?: string}>, label?: string, removable?: boolean, max?: number, act?: string, emptyText?: string, k?: string}} p
 * `label` names the list (default "Tags"); `removable` adds a remove button per tag (`act`, default "tags:remove", with data-v the tag id); `max` shows that many tags and folds the rest into "+N"; `emptyText` is shown when there are no tags; `k` prefixes each remove button's data-k ("<k>-<id>", default "tag-remove"): give every removable list on a page its own, or focus restore can land in the wrong list. Tags without an `id` use their text, and duplicate ids keep the caller's id in data-v and get an index suffix on data-k only, so data-k stays unique. After a removal the focused button is gone: the app should focus the next remove button (or the list, which is tabindex -1) itself.
 * @emits tags:remove (data-v; or the act you pass)
 * @states default, removable, overflow, empty
 * @a11y Motion: tag and remove-button colours ease over --dur-2; reduced motion drops the press scale only. A labelled list; the tone only tints the tag, the text is the meaning. Each remove button is named "Remove <tag>" and has data-k "<k>-<id>" (default "tag-remove-<id>"). A removable tag with a tip has two tab stops (the tag and its remove button). The "+N" entry is focusable and lists the hidden tags in sr-only text and in its tip.
 * @example default: tags({ items: ["Finance", { text: "Internet facing", tone: "warn" }, { text: "Encrypted", tone: "ok" }] })
 * @example removable: tags({ items: [{ text: "Finance", id: "fin" }, { text: "EU", id: "eu" }], removable: true, label: "Selected tags" })
 * @example overflow: tags({ items: ["One", "Two", "Three", "Four", "Five"], max: 3 })
 * @example empty: tags({ items: [], emptyText: "No tags" })
 */
export function tags(p) {
  const q = p || { items: [] };
  const all = (Array.isArray(q.items) ? q.items : []).map(norm).filter((t) => t.text !== "");
  const kp = q.k ? String(q.k) : "tag-remove";
  const seen = /** @type {Record<string, number>} */ ({});
  /** @type {Record<string, boolean>} */
  const used = {};
  for (const t of all) used[kp + "-" + t.id] = true;
  for (const t of all) {
    const n = seen[t.id] = (seen[t.id] || 0) + 1;
    let key = kp + "-" + t.id;
    if (n > 1) {
      let i = n;
      while (used[key = kp + "-" + t.id + "-" + i]) i++;
      used[key] = true;
    }
    t.key = key;
  }
  if (!all.length) return q.emptyText ? html`<span class="gk-tags__empty">${q.emptyText}</span>` : html``;
  const max = typeof q.max === "number" && q.max >= 0 ? Math.floor(q.max) : all.length;
  const shown = all.slice(0, max);
  const hidden = all.slice(max);
  const act = q.act || "tags:remove";
  const more = hidden.map((t) => t.text).join(", ");
  return html`<ul class="gk-tags" role="list" tabindex="-1" aria-label="${q.label || "Tags"}">${shown.map((t) => html`<li class="gk-tags__tag is-${t.tone}"${t.tip ? html` tabindex="0" data-tip="${t.tip}"` : ""}><span class="gk-tags__text">${t.text}</span>${t.tip ? html`<span class="sr-only">. ${t.tip}</span>` : ""}${q.removable ? html`<button type="button" class="gk-tags__remove gk-btn" data-variant="ghost" data-size="icon" data-act="${act}" data-v="${t.id}" data-k="${t.key}" aria-label="Remove ${t.text}" data-tip="Remove ${t.text}"><span aria-hidden="true">×</span></button>` : ""}</li>`)}${hidden.length ? html`<li class="gk-tags__tag gk-tags__more" tabindex="0" data-tip="${more}"><span aria-hidden="true">+${fmtCount(hidden.length)}</span><span class="sr-only">${fmtCount(hidden.length)} more: ${more}</span></li>` : ""}</ul>`;
}
