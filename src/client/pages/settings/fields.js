// Field mapping tab: every field of the catalogue by group, the Sheet column that feeds it (a
// select of the real headers of the bound tab) and an example value from the Sheet. The callout
// counts the fields with no column and follows the draft. A pure view.
import { html } from "../../lib/html.js";
import { count } from "../../lib/format.js";
import { dot } from "../../components/dots.js";
import { FIELDS, GROUPS } from "../../../domain/fields";
import { unmappedFields } from "./draft.js";

/** Mapped columns the bound tab no longer has (only known once the headers were read). */
export function missingColumns(session) {
  const out = [];
  for (const d of FIELDS) {
    const header = session.draft["fields." + d.key];
    const list = session.headers[session.saved.fields[d.key].binding];
    if (header !== "" && list && list.indexOf(header) < 0) out.push(d);
  }
  return out;
}

function callout(session) {
  const un = unmappedFields(session.draft).length;
  const miss = missingColumns(session).length;
  if (!un && !miss) return "";
  return html`<div class="callout" role="status" data-callout>${dot("warn")}<span>${un ? html`<b>${count(un, "field")} ${un === 1 ? "is" : "are"} not mapped.</b> They show as empty on every application and count as missing in completeness. Pick the column that holds them, or leave them unmapped until the data exists.` : ""}${un && miss ? " " : ""}${miss ? html`<b>${count(miss, "mapped column")} ${miss === 1 ? "was" : "were"} not found in the Sheet.</b> Those fields stay empty until a column with that name exists.` : ""}</span></div>`;
}

function row(session, d) {
  const key = "fields." + d.key;
  const header = session.draft[key];
  const binding = session.saved.fields[d.key].binding;
  const list = session.headers[binding] || [];
  const known = list.indexOf(header) >= 0;
  const ex = (session.examples[binding] || {})[header];
  const flagged = header === "" || (!known && session.headers[binding]);
  return html`<tr data-field="${d.key}"><td>${d.label}</td>
    <td><select class="sel${flagged ? " unmapped" : ""}" data-key="${key}" data-type="text" data-k="map-${d.key}" aria-label="Column for ${d.label}"><option value=""${header === "" ? html` selected` : ""}>Not mapped</option>${header !== "" && !known ? html`<option value="${header}" selected>${header} (not in the Sheet)</option>` : ""}${list.filter((h) => h !== "").map((h) => html`<option value="${h}"${h === header ? html` selected` : ""}>${h}</option>`)}</select></td>
    <td class="ex" data-example>${header !== "" && ex !== undefined ? ex : html`<span class="mut">—</span>`}</td></tr>`;
}

/** ctx: {session}. */
export function fieldsView(ctx) {
  const { session } = ctx;
  return html`${callout(session)}
    <div class="mt"><table><thead><tr><th>CCCP field</th><th>Sheet column</th><th>Example value</th></tr></thead><tbody>
    ${GROUPS.map((g) => html`<tr class="pgrp"><td colspan="3">${g}</td></tr>${FIELDS.filter((d) => d.group === g).map((d) => row(session, d))}`)}
    </tbody></table></div>`;
}
