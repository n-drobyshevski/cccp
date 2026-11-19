import { html } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { copyText } from "@gas-kit/client/clipboard.js";

const VARIANTS = ["default", "secondary", "outline", "ghost"];
const SIZES = ["sm", "default", "lg", "icon"];
const FAILED = "Copy failed. Select the text and copy it yourself.";

/**
 * @component copyButton
 * @title Copy Button
 * @category Forms
 * @summary A button that copies a piece of text and says, in place, whether it worked.
 * @param {{text: string, label?: string, size?: "sm"|"default"|"lg"|"icon", variant?: "default"|"secondary"|"outline"|"ghost", doneLabel?: string, failLabel?: string, k?: string}} p
 * `text` is what lands on the clipboard; it travels in the data-props of the wrapper, so the view never needs a click handler of its own. `label` is the visible word (default "Copy") and the accessible name of an icon-only button (`size: "icon"`). `doneLabel` (default "Copied") and `failLabel` are announced. Register the island once with `mountIslands(root, { copyButton: copyButtonIsland })`. `k` goes to `data-k` on the button.
 * @emits none (the island copies on click and announces the result)
 * @states default, icon-only, ghost, empty
 * @a11y A native button inside a span that holds a polite live region (role status). After a click the region says "Copied", or the failure sentence when the clipboard refused (an embedded frame may), and the button shows a check icon for about 1.5 seconds, or an alert icon on failure, so the result is never colour alone. An icon-only button is named by aria-label and data-tip. Without script the button is inert. Motion: none beyond the icon swap.
 * @example default: copyButton({ text: "npm install acme-kit", k: "copy-install" })
 * @example icon-only: copyButton({ text: "ACME-1042", size: "icon", label: "Copy ticket id", k: "copy-id" })
 * @example ghost: copyButton({ text: "dana.reyes@example.org", variant: "ghost", size: "sm", label: "Copy email", k: "copy-email" })
 * @example empty: copyButton({ text: "" })
 */
export function copyButton(p) {
  const q = p || { text: "" };
  const text = q.text != null ? String(q.text) : "";
  const variant = VARIANTS.indexOf(String(q.variant)) >= 0 ? String(q.variant) : "outline";
  const size = SIZES.indexOf(String(q.size)) >= 0 ? String(q.size) : "sm";
  const label = q.label != null && q.label !== "" ? String(q.label) : "Copy";
  const done = q.doneLabel != null && q.doneLabel !== "" ? String(q.doneLabel) : "Copied";
  const fail = q.failLabel != null && q.failLabel !== "" ? String(q.failLabel) : FAILED;
  const only = size === "icon";
  const props = JSON.stringify({ text, done, fail });
  const k = q.k != null && q.k !== "" ? String(q.k) : null;
  return html`<span class="gk-copyButton" data-mount="copyButton" data-props="${props}"><button type="button" class="gk-btn gk-copyButton__btn" data-variant="${variant}" data-size="${size}" data-k="${k}" aria-label="${only ? label : null}" data-tip="${only ? label : null}"><span class="gk-copyButton__icon gk-copyButton__icon--copy">${icon("copy")}</span><span class="gk-copyButton__icon gk-copyButton__icon--check">${icon("check")}</span><span class="gk-copyButton__icon gk-copyButton__icon--fail">${icon("alert")}</span>${only ? "" : html`<span class="gk-copyButton__label">${label}</span>`}</button><span class="sr-only" role="status" aria-live="polite" data-role="status"></span></span>`;
}

/**
 * Make the island. `copy(text)` resolves true when the text was copied; `ms` is how long the
 * check icon stays; `later(fn, ms)` returns a cancel function. All three are injectable for tests.
 * @param {{copy?: (text: string) => Promise<boolean>, ms?: number, later?: (fn: () => void, ms: number) => (() => void)}} [deps]
 * @returns {import("@gas-kit/client/islands.js").Island}
 * @internal
 */
export function createCopyButtonIsland(deps) {
  const d = deps || {};
  const copy = d.copy || copyText;
  const ms = d.ms != null ? d.ms : 1500;
  const later = d.later || ((fn, n) => { const t = setTimeout(fn, n); return () => clearTimeout(t); });
  return {
    mount(el, data) {
      const btn = el.querySelector("button");
      const status = el.querySelector("[data-role=status]");
      if (!btn) return undefined;
      const text = data && data.text != null ? String(data.text) : "";
      /** @type {(() => void) | null} */
      let cancel = null;
      let gone = false;
      const reset = () => {
        cancel = null;
        el.classList.remove("is-done");
        el.classList.remove("is-failed");
        if (status) status.textContent = "";
      };
      let seq = 0;
      const onClick = () => {
        if (cancel) cancel();
        reset();
        const n = ++seq;
        Promise.resolve().then(() => (text === "" ? false : copy(text))).then((ok) => ok === true, () => false).then((ok) => {
          if (gone || n !== seq) return;
          if (cancel) cancel();
          reset();
          el.classList.add(ok ? "is-done" : "is-failed");
          if (status) status.textContent = ok ? String((data && data.done) || "Copied") : String((data && data.fail) || FAILED);
          cancel = later(reset, ok ? ms : ms * 3);
        });
      };
      btn.addEventListener("click", onClick);
      return () => {
        gone = true;
        if (cancel) cancel();
        btn.removeEventListener("click", onClick);
        reset();
      };
    },
  };
}

/** The island the app registers as `copyButton` in `mountIslands(root, { copyButton: copyButtonIsland })`. */
export const copyButtonIsland = createCopyButtonIsland();
