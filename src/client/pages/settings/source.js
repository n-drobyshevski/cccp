// Data source tab: the connection card with Reload, the Sheet link (the owner edits and probes
// it; an admin reads it), the cache time, the table of Sheet tabs with their rows and missing
// columns, and the advanced join and pick options under a disclosure. A pure view: page.js owns
// the draft and runs the actions (s-probe, s-reload, s-adv).
import { html } from "../../lib/html.js";
import { count, num, stamp } from "../../lib/format.js";
import { dot } from "../../components/dots.js";
import { TAB_LABEL } from "./draft.js";
import { TAB_KEYS } from "../../../domain/types";

const JOIN_ON = [["id", "Application id"], ["name", "Application name"]];
const PICK = [["first", "First row"], ["latest", "Latest by date"]];

/** The link shown for a Sheet the viewer may only read. */
function readOnlyLink(meta, draft) {
  return meta.url || draft["source.sheetId"] || "No Sheet connected yet";
}

function tabNames(ctx) {
  const names = [];
  const add = (n) => { if (n && names.indexOf(n) < 0) names.push(n); };
  const probe = ctx.ui.probe;
  if (probe && probe.result) probe.result.tabs.forEach((t) => add(t.name));
  for (const k of TAB_KEYS) { add(ctx.session.savedDraft["source.tabs." + k + ".name"]); add(ctx.session.draft["source.tabs." + k + ".name"]); }
  return names;
}

function statusOf(ctx, k) {
  const { session, meta } = ctx;
  const name = session.draft["source.tabs." + k + ".name"];
  if (name === "") return { word: "Not used", cls: "", tip: "No Sheet tab is bound, so these fields stay empty." };
  if (name !== session.savedDraft["source.tabs." + k + ".name"]) return { word: "Save to check", cls: "", tip: "The new tab is read after you save." };
  const missingTab = meta.issues && meta.issues.missingTabs && meta.issues.missingTabs.indexOf(k) >= 0;
  if (missingTab) return { word: "Tab not found", cls: "bad", tip: "The workbook has no tab called " + name + "." };
  const t = meta.tabs.find((x) => x.key === k);
  if (t && t.missingHeaders && t.missingHeaders.length) return { word: "Columns missing", cls: "warn", tip: "Not found in this tab: " + t.missingHeaders.join(", ") };
  return { word: "OK", cls: "ok", tip: "" };
}

function connection(ctx) {
  const { meta, ui, rows } = ctx;
  const connected = meta.title !== "";
  const missing = !!(meta.issues && meta.issues.missingTabs && meta.issues.missingTabs.length) || (meta.tabs || []).some((t) => t.missingHeaders && t.missingHeaders.length);
  const when = ui.reloadedAt ? "just now" : meta.loadedAt ? stamp(meta.loadedAt) : "never";
  return html`<div class="conn" data-region="conn"><div><b>${dot(connected && !missing ? "ok" : "warn")}${connected ? html`Connected to “${meta.title}”` : "No Sheet connected"}</b><small data-loaded>Last loaded ${when} · ${count(rows.length, "application")}</small></div>
    <button type="button" class="btn" data-act="s-reload" data-k="reload"${ui.reloadBusy || !connected ? html` disabled` : ""}>${ui.reloadBusy ? html`<span class="spin" aria-hidden="true"></span>Loading…` : "Reload data"}</button></div>`;
}

function probeResult(p) {
  if (!p || (p.state !== "busy" && p.state !== "err" && p.state !== "ok")) return "";
  if (p.state === "busy") return html`<p class="probe" role="status"><span class="spin" aria-hidden="true"></span>Looking at the Sheet…</p>`;
  if (p.state === "err") return html`<p class="probe bad" role="alert" data-probe>${p.message}</p>`;
  const r = p.result;
  return html`<p class="probe ok" role="status" data-probe>Found “${r.title}” (${r.tz}) with ${count(r.tabs.length, "tab")}: ${r.tabs.map((t, i) => html`${i ? ", " : ""}${t.name} (${count(t.rows, "row")})`)}.</p>`;
}

function linkField(ctx) {
  const { session, viewer, meta, ui } = ctx;
  const draft = session.draft;
  if (!viewer.canEditSource) {
    return html`<div class="sf"><div class="sfl"><b>Google Sheet</b><small>The spreadsheet CCCP reads, with the deployer’s access.</small></div>
      <div class="sfc"><span class="ro" data-readonly-link>${readOnlyLink(meta, draft)}</span>
      <small class="mut why-ro">Only the owner can change the source Sheet or probe it, because the app reads it with the owner’s access.</small></div></div>`;
  }
  const err = ctx.errors["source.sheetId"];
  return html`<div class="sf"><div class="sfl"><label for="st-sheet"><b>Google Sheet</b></label><small>The spreadsheet CCCP reads. The app reads it with your access, so viewers don’t need access to the Sheet.</small></div>
    <div class="sfc"><input id="st-sheet" class="inp wide${err ? " bad" : ""}" data-key="source.sheetId" data-type="text" data-k="sheet" value="${draft["source.sheetId"]}" placeholder="Paste the Google Sheet link" aria-label="Google Sheet link"${err ? html` aria-invalid="true"` : ""}>
      <button type="button" class="btn" data-act="s-probe" data-k="probe"${ui.probe && ui.probe.state === "busy" ? html` disabled` : ""}>Probe</button>
      ${err ? html`<small class="errtxt" role="alert">${err}</small>` : ""}${probeResult(ui.probe)}</div></div>`;
}

function tabsTable(ctx) {
  const { session, meta } = ctx;
  const names = tabNames(ctx);
  const saved = session.savedDraft;
  return html`<div class="sgrp"><h3>Sheet tabs</h3><div class="mt"><table><thead><tr><th>Data</th><th>Tab</th><th class="num">Rows</th><th>Status</th></tr></thead><tbody>
    ${TAB_KEYS.map((k) => {
      const key = "source.tabs." + k + ".name";
      const cur = session.draft[key];
      const st = statusOf(ctx, k);
      const t = meta.tabs.find((x) => x.key === k);
      const same = cur === saved[key];
      const unmatched = same && t && t.unmatched ? html`<small class="mut"> · ${count(t.unmatched, "row")} ${t.unmatched === 1 ? "matches" : "match"} no application</small>` : "";
      return html`<tr data-tab-row="${k}"><td>${TAB_LABEL[k]}</td>
        <td><select class="sel" data-key="${key}" data-type="text" data-k="tab-${k}" aria-label="${TAB_LABEL[k]} tab">${k === "apps" ? "" : html`<option value=""${cur === "" ? html` selected` : ""}>Not used</option>`}${names.map((n) => html`<option value="${n}"${n === cur ? html` selected` : ""}>${n}</option>`)}</select></td>
        <td class="num" data-rows>${same && t && cur !== "" ? num(t.rows) : "—"}</td>
        <td>${st.cls ? html`<span class="res ${st.cls}"${st.tip ? html` tabindex="0" data-tip="${st.tip}" aria-label="${st.word + ": " + st.tip}"` : ""}>${st.word}</span>` : html`<span class="mut">${st.word}</span>`}${unmatched}</td></tr>`;
    })}
  </tbody></table></div></div>`;
}

function issues(ctx) {
  const iss = ctx.meta.issues || {};
  const items = [];
  const dup = (iss.duplicateIds || []).length;
  if (dup) items.push(count(dup, "repeated id") + " in the Sheet: the first row of each is used.");
  const unp = (iss.unparseable || []).reduce((n, u) => n + u.count, 0);
  if (unp) items.push(count(unp, "value") + " could not be read as a date or number and stay empty.");
  if (!items.length) return "";
  return html`<ul class="issues" data-issues>${items.map((t) => html`<li>${dot("warn")}<span>${t}</span></li>`)}</ul>`;
}

function advanced(ctx) {
  const { session, ui } = ctx;
  const open = !!ui.adv;
  const rowsFor = TAB_KEYS.filter((k) => k !== "apps" && session.draft["source.tabs." + k + ".name"] !== "");
  return html`<div class="sgrp"><button type="button" class="disc" data-act="s-adv" data-k="adv" aria-expanded="${open ? "true" : "false"}" aria-controls="st-adv">Advanced: how the tabs are joined</button>
    ${open ? html`<div id="st-adv" class="mt"><table><thead><tr><th>Tab</th><th>Id column</th><th>Join on</th><th>When several rows</th></tr></thead><tbody>
      ${rowsFor.length ? rowsFor.map((k) => {
        const p = "source.tabs." + k + ".";
        return html`<tr><td>${TAB_LABEL[k]}</td>
          <td><input class="inp" data-key="${p}joinColumn" data-type="text" data-k="jc-${k}" value="${session.draft[p + "joinColumn"]}" aria-label="${TAB_LABEL[k]} id column"></td>
          <td><select class="sel" data-key="${p}joinOn" data-type="text" data-k="jo-${k}" aria-label="${TAB_LABEL[k]} join on">${JOIN_ON.map(([v, l]) => html`<option value="${v}"${session.draft[p + "joinOn"] === v ? html` selected` : ""}>${l}</option>`)}</select></td>
          <td><select class="sel" data-key="${p}pick" data-type="text" data-k="pk-${k}" aria-label="${TAB_LABEL[k]} row pick">${PICK.map(([v, l]) => html`<option value="${v}"${session.draft[p + "pick"] === v ? html` selected` : ""}>${l}</option>`)}</select></td></tr>`;
      }) : html`<tr><td colspan="4" class="mut">No side tabs are in use.</td></tr>`}
    </tbody></table></div>` : ""}</div>`;
}

/** ctx: {session, meta, viewer, ui, errors, rows}. */
export function sourceView(ctx) {
  const cache = ctx.session.draft["source.cacheMinutes"];
  return html`${connection(ctx)}
    <div class="sgrp">${linkField(ctx)}
    <div class="sf"><div class="sfl"><label for="st-cache"><b>Keep data in memory for</b></label><small>After this, the next visitor reloads from the Sheet.</small></div>
      <div class="sfc"><span class="numu"><input id="st-cache" type="number" min="1" max="360" data-key="source.cacheMinutes" data-type="number" data-k="cache" value="${cache}" aria-label="Cache minutes"><span>minutes</span></span></div></div></div>
    ${issues(ctx)}${tabsTable(ctx)}${advanced(ctx)}`;
}
