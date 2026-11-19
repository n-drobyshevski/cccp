// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A modal dialog on the native dialog element. The view is pure; dialogIsland (mounted with
// mountIslands(root, { dialog: dialogIsland })) calls showModal() and reports every close through
// the close button's data-act, so the app has one place to flip its state. The sheet shares it.
import { html, attrs } from "@gas-kit/client/html.js";
import { quote } from "@gas-kit/client/dom.js";

const X = html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;

/**
 * The markup shared by dialog and sheet.
 * @internal
 * @param {"dialog"|"sheet"} kind
 * @param {any} q
 * @param {Record<string, unknown>} [extra] attributes for the dialog element
 */
export function overlayMarkup(kind, q, extra) {
  const id = q.id != null && q.id !== "" ? String(q.id) : kind;
  const act = q.closeAct || kind + ":close";
  const hasTitle = q.title != null && q.title !== "";
  const hasDesc = q.description != null && q.description !== "";
  const cls = "gk-" + kind;
  return html`<dialog ${attrs({
    class: cls, id, "aria-labelledby": hasTitle ? id + "-title" : null, "aria-label": hasTitle ? null : q.label || "Dialog",
    "aria-describedby": hasDesc ? id + "-desc" : null, "data-mount": "dialog",
    "data-props": JSON.stringify(q.returnK ? { open: q.open === true, returnK: String(q.returnK) } : { open: q.open === true }), ...(extra || {}),
  })}><div class="${cls}__panel"><div class="${cls}__header">${hasTitle ? html`<h2 class="${cls}__title" id="${id}-title">${q.title}</h2>` : ""}${hasDesc ? html`<p class="${cls}__description" id="${id}-desc">${q.description}</p>` : ""}</div>${q.content != null ? html`<div class="${cls}__body">${q.content}</div>` : ""}${q.footer != null ? html`<div class="${cls}__footer">${q.footer}</div>` : ""}${q.showClose === false ? "" : html`<button ${attrs({ type: "button", class: "gk-btn " + cls + "__close", "data-variant": "ghost", "data-size": "icon", "aria-label": q.closeLabel || "Close", "data-act": act, "data-k": id + "-close", "data-dialog-close": "" })}>${X}</button>`}</div></dialog>`;
}

/**
 * @component dialog
 * @title Dialog
 * @category Overlays
 * @summary A modal dialog with a header, body, footer and close button, on the native dialog element.
 * @param {{id: string, open?: boolean, title?: string, description?: string, content?: unknown, footer?: unknown, label?: string, closeLabel?: string, closeAct?: string, showClose?: boolean, returnK?: string}} p
 * `open` is the app's state: when true, dialogIsland calls showModal() on mount; when false the dialog is rendered closed (or leave it out). `title` and `description` name and describe it (aria-labelledby, aria-describedby); without a title `label` is the name. `content` and `footer` are SafeHtml or text; put gk-btn buttons in the footer with their own data-act. `closeAct` defaults to "dialog:close". `returnK` is the data-k of the opener: focus returns to it when the dialog closes, also after the app re-renders. Mount dialogIsland after every render. The existing confirm component is separate.
 * @emits dialog:close (the close button, Escape and a click on the backdrop all click the close button, so the app handles one act; or the closeAct you pass)
 * @states closed, open, no-footer
 * @a11y A native dialog opened with showModal(): focus moves inside, the page behind is inert, Tab stays in the dialog, Escape closes it. A backdrop click closes it. The close button has an aria-label and a drawn cross. On close focus goes back to the opener found by data-k. Motion: fades and scales in over --dur-3, the scale and travel multiplied by --motion-scale, so reduced motion is a fade only.
 * @example open: dialog({ id: "dlg-open", open: true, title: "Edit profile", description: "Change how others see you.", content: "Fields go here.", footer: "Buttons go here.", returnK: "btn-edit" })
 * @example closed: dialog({ id: "dlg-edit", title: "Edit profile", description: "Change how others see you.", content: "Fields go here.", footer: "Buttons go here." })
 * @example no-footer: dialog({ id: "dlg-info", open: true, title: "About", content: "Acme register, version one.", closeLabel: "Dismiss" })
 */
export function dialog(p) {
  return overlayMarkup("dialog", p || { id: "dialog" });
}

/**
 * The island for a dialog or a sheet, mounted on the dialog element. It opens the dialog modally
 * when data-props.open is true. Escape and a backdrop click close it and click the close button
 * once, so the delegated close act runs as for a pointer. On teardown (the app re-rendered or
 * removed it) an open dialog is closed quietly. Focus returns to the element with data-k
 * returnK.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const dialogIsland = {
  mount(el, data) {
    const d = /** @type {any} */ (el);
    const props = data || {};
    let told = false;
    const focusOpener = () => {
      if (!props.returnK) return;
      const doc = el.ownerDocument;
      const o = /** @type {any} */ (doc.querySelector('[data-k="' + quote(String(props.returnK)) + '"]'));
      if (o && typeof o.focus === "function") o.focus();
    };
    const tell = () => {
      if (told) return;
      told = true;
      const b = /** @type {any} */ (el.querySelector("[data-dialog-close]"));
      if (b) b.click();
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const t = ev.target;
      if (t === el) { if (typeof d.close === "function") d.close(); return; }
      if (t && t.closest && t.closest("[data-dialog-close]")) { told = true; if (typeof d.close === "function") d.close(); }
    };
    const onClose = () => { tell(); told = false; focusOpener(); };
    el.addEventListener("click", onClick);
    el.addEventListener("close", onClose);
    if (props.open === true && !d.open && typeof d.showModal === "function") d.showModal();
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("close", onClose);
      if (d.open && typeof d.close === "function") { told = true; d.close(); }
      focusOpener();
    };
  },
};
