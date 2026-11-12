// The Columns menu of the list: one checkbox per column, Application fixed. The choice is the
// vendored tableModel's signed deviations from the defaults ('-so' hidden, '+ty' shown), held
// in the URL (store.cols) and remembered in this browser under 'cccp.cols'. Because only the
// deviations are stored, a column added later arrives at its own default for everybody.
import { html } from "../lib/html.js";
import * as storage from "../lib/storage.js";
import { columnChoices } from "../../vendor/gas_shared/ui/tableModel";
import { COLUMNS, choiceOf, signedKeys } from "../../domain/columns";

export const COLS_KEY = "cols";

/** The remembered choice as signed keys; unknown keys are dropped. Empty when none or refused. */
export function readCols() {
  const raw = storage.getJson(COLS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return signedKeys(choiceOf(raw.filter((k) => typeof k === "string")));
}

export function writeCols(signed) {
  return signed.length ? storage.setJson(COLS_KEY, signed) : storage.remove(COLS_KEY);
}

/** The chooser's rows for a signed choice and the active sort: {key, label, shown, hideable}. */
export function chooserRows(signed, sort) {
  return columnChoices(COLUMNS, choiceOf(signed), sort);
}

/** The menu body. */
export function chooserView(signed, sort) {
  const rows = chooserRows(signed, sort);
  return html`<div class="popin"><span class="lbl mlbl">Columns</span><div class="plist" data-list="cols">${rows.map((c) => html`<label class="ck${c.hideable ? "" : " zero"}"${c.hideable ? "" : html` data-tip="Always shown"`}><input type="checkbox" data-act="col" data-col="${c.key}" data-k="col-${c.key}"${c.shown ? " checked" : ""}${c.hideable ? "" : " disabled"}><span>${c.label}</span></label>`)}</div>${signed.length ? html`<div class="pfoot"><button type="button" class="linkbtn" data-act="cols-reset" data-k="cols-reset">Reset to default</button></div>` : ""}</div>`;
}
