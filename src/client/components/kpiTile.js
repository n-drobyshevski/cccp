// A headline figure (identity G) on the kit kpiTile: the value in mono, its label, the share it is of
// its denominator (the app computes the note) and "Open in inventory ›" (drawn by the app's CSS after
// the tile's text). The whole tile is a button that opens the Inventory with the filters that
// reproduce the number: data-act="go", data-k="kpi-<id>" and the target as JSON in data-v.
import { kpiTile as kitTile } from "@gas-kit/ui/components/kpiTile.js";
import { fmtCount } from "@gas-kit/client/format.js";

/** The line under the label. */
export function kpiNote(k) {
  return k.id === "eol"
    ? "still listed as running"
    : k.id === "t1gap" ? "of " + fmtCount(k.denominator) + " " + k.of
    : k.id === "gap" ? k.pct + "% of " + fmtCount(k.denominator)
    : k.id === "noso" ? k.pct + "% of " + k.of
    : k.pct + "% of " + fmtCount(k.denominator) + " " + k.of;
}

export function kpiTile(k) {
  return kitTile({ label: k.label, value: k.value, note: kpiNote(k), act: "go", k: "kpi-" + k.id, v: JSON.stringify(k.target) });
}
