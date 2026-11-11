// A modal yes/no. Resolves true on the confirm button, false on Cancel, Escape or a click on
// the backdrop. Focus moves into the dialog and returns to where it was.
import { delegate, renderRegion } from "./dom.js";
import { html } from "./html.js";

export function confirmDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const before = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "scrim";
    document.body.appendChild(wrap);
    renderRegion(wrap, html`<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
      <h2 id="dlg-t">${o.title || "Are you sure?"}</h2>
      ${o.body ? html`<p>${o.body}</p>` : ""}
      <div class="dlg-act">
        <button type="button" class="btn" data-act="no" data-k="no">${o.cancelLabel || "Cancel"}</button>
        <button type="button" class="btn ${o.danger ? "danger" : "primary"}" data-act="yes" data-k="yes">${o.confirmLabel || "Confirm"}</button>
      </div></div>`, { keepFocus: false, keepScroll: false });
    const done = (v) => {
      document.removeEventListener("keydown", onKey, true);
      wrap.remove();
      if (before && before.focus) before.focus();
      resolve(v);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); done(false); return; }
      if (ev.key !== "Tab") return;
      const btns = Array.from(wrap.querySelectorAll(".dlg button"));
      if (!btns.length) return;
      const first = btns[0];
      const last = btns[btns.length - 1];
      const at = document.activeElement;
      if (btns.indexOf(at) < 0) { ev.preventDefault(); first.focus(); }
      else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    delegate(wrap, "click", "[data-act]", (ev, el) => done(el.getAttribute("data-act") === "yes"));
    wrap.addEventListener("pointerdown", (ev) => { if (ev.target === wrap) done(false); });
    const yes = wrap.querySelector('[data-k="yes"]');
    if (yes) yes.focus();
  });
}
