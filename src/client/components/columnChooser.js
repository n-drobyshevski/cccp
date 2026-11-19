// The Columns menu of the list, on the kit columnChooser (a button and a native popover of
// checkboxes, Application fixed). The choice is the tableModel's signed deviations from the
// defaults ('-so' hidden, '+ty' shown), held in the URL (store.cols) and remembered in this browser
// under 'cccp.cols'. Because only the deviations are stored, a column added later arrives at its
// own default for everybody. The stored format is the app's own, read and written here (not through
// the kit's store helpers), so a list saved by an earlier build still reads back.
import { columnChooser } from "@gas-kit/ui/components/columnChooser.js";
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

/**
 * The menu (trigger and panel). The column being sorted cannot be hidden, so it is passed to the
 * kit as pinned, like Application.
 */
export function chooserView(signed, sort) {
  return columnChooser({
    id: "cols",
    columns: COLUMNS.map((c) => ({ key: c.key, label: c.label, hidden: c.defaultHidden, pinned: c.pinned || c.key === sort })),
    deviations: signed,
  });
}
