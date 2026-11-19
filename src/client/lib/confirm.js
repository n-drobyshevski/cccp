// A modal yes/no on the kit confirm view and island. Resolves true on the confirm button, false
// on Cancel, Escape or a click on the scrim. The island moves focus in (Cancel when the action is
// destructive, so Enter is never the harmful key), traps Tab and returns focus to the opener.
// opts: title, body, confirmLabel, cancelLabel, danger.
import { delegate, renderRegion } from "@gas-kit/client/dom.js";
import { mountIslands } from "@gas-kit/client/islands.js";
import { confirmDialog as confirmView, confirmIsland } from "@gas-kit/ui/components/confirm.js";

let seq = 0;

export function confirmDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    renderRegion(wrap, confirmView({
      id: "confirm-" + (++seq),
      title: o.title || "Are you sure?",
      body: o.body || null,
      confirmLabel: o.confirmLabel,
      cancelLabel: o.cancelLabel,
      destructive: !!o.danger,
    }), { keepFocus: false, keepScroll: false });
    // The island's teardown returns focus to the opener, so run it before the node goes.
    const off = mountIslands(wrap, { confirm: confirmIsland });
    const done = (v) => {
      offClick();
      off();
      wrap.remove();
      resolve(v);
    };
    const offClick = delegate(wrap, "click", "[data-act]", (ev, el) => done(el.getAttribute("data-act") === "confirm:ok"));
  });
}
