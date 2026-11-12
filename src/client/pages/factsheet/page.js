// The application fact sheet (route 'app', ?app=ID): the Sections page of lx2 with data quality on.
// Header with the status buttons, the Fact sheet | People tabs, the sections with jump and find,
// and the collapsible data-quality sidebar. State that persists lives in localStorage under
// 'cccp.fs.closed' (collapsed sections), 'cccp.fs.sidebar' and 'cccp.recent'; every read is
// wrapped, so with storage refused the page still works and forgets on reload.
import { delegate, qs, renderRegion } from "../../lib/dom.js";
import { html } from "../../lib/html.js";
import { copyText } from "../../lib/clipboard.js";
import * as storage from "../../lib/storage.js";
import { toast } from "../../lib/toast.js";
import { emptyState } from "../../shell/states.js";
import { registerPage } from "../../shell/router.js";
import * as register from "../../state/register.js";
import { store } from "../../state/store.js";
import { linkFor, navigate } from "../../state/url.js";
import { SECTION_KEYS, factsheetModel, findInSections, pushRecent, recentFor, reviewMonthsOf } from "../../../domain/factsheet";
import { headerView, tabsView } from "./header.js";
import { tabKeys } from "../../lib/tabKeys.js";
import { barView, sectionsView } from "./sections.js";
import { peopleView } from "./people.js";
import { sidebarView } from "./dqSidebar.js";

const FROM = ["list", "overview"];
const KEY_CLOSED = "fs.closed";
const KEY_SIDE = "fs.sidebar";
const KEY_RECENT = "recent";

// Which page the viewer came from, so Back and the breadcrumb return there. A link opened cold
// has no earlier page and goes to the list.
let cameFrom = "list";
store.subscribe((s) => { if (FROM.indexOf(s.route) >= 0) cameFrom = s.route; });

export const closedSections = () => {
  const v = storage.getJson(KEY_CLOSED, []);
  return new Set(Array.isArray(v) ? v.filter((k) => SECTION_KEYS.indexOf(k) >= 0) : []);
};
const saveClosed = (set) => storage.setJson(KEY_CLOSED, Array.from(set));
export const sidebarCollapsed = () => storage.get(KEY_SIDE) === "collapsed";
const saveSidebar = (collapsed) => storage.set(KEY_SIDE, collapsed ? "collapsed" : "open");
const recentList = () => { const v = storage.getJson(KEY_RECENT, []); return Array.isArray(v) ? v : []; };

/** The model for a row under the current settings and Sheet metadata. */
export function modelFor(row, s) {
  const core = s.core;
  const meta = core && core.sourceMeta ? core.sourceMeta : null;
  const tab = meta && meta.tabs ? meta.tabs.find((t) => t.key === "apps") : null;
  return factsheetModel(row, {
    today: s.live ? s.live.today : "",
    reviewMonths: reviewMonthsOf(core ? core.publicSettings.rules : null),
    sheetUrl: meta ? meta.url : null,
    sheetGid: tab ? tab.gid : null,
  });
}

const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

export const factsheetPage = {
  mount(el, ctx) {
    const s0 = store.get();
    const row = register.byId(s0.app);
    if (!row) {
      renderRegion(el, emptyState({
        title: "Application not found",
        body: "The link may be old, or the application may have been removed from the register.",
        action: { act: "back", label: "Back to the list" },
      }), { keepFocus: false, keepScroll: false });
      return null;
    }
    const id = row.app.id;
    store.set({ fs: { tab: "sheet", find: "" } });
    storage.setJson(KEY_RECENT, pushRecent(recentList(), id));
    window.scrollTo(0, 0);

    let closed = closedSections();
    let collapsed = sidebarCollapsed();
    let model = modelFor(row, store.get());

    renderRegion(el, html`<div class="lxwrap${collapsed ? " sbc" : ""}" data-page="app" data-app-id="${id}"><article class="fs lxs"><div data-region="fshead"></div><div data-region="fsbody" id="fs-panel" role="tabpanel"></div></article><div data-region="fsside"></div></div>`, { keepFocus: false, keepScroll: false });
    const wrap = qs(el, ".lxwrap");
    const head = qs(el, '[data-region="fshead"]');
    const body = qs(el, '[data-region="fsbody"]');
    const side = qs(el, '[data-region="fsside"]');

    const fs = () => store.get().fs;
    const drawHead = () => renderRegion(head, html`${headerView(model.header, cameFrom, true)}${tabsView(fs().tab, model.people.count)}`);
    const drawSecs = () => {
      const target = qs(body, '[data-region="fssecs"]');
      if (!target) return;
      const found = findInSections(model.sections, fs().find);
      renderRegion(target, sectionsView(found.sections, closed, !!fs().find.trim()), { keepFocus: false });
    };
    const drawBody = () => {
      if (fs().tab === "people") { renderRegion(body, peopleView(model.people)); return; }
      renderRegion(body, html`${barView(fs().find)}<div data-region="fssecs"></div>`);
      drawSecs();
    };
    const drawSide = () => {
      const recent = recentFor(recentList(), id).map((x) => register.byId(x)).filter(Boolean).map((r) => ({ id: r.app.id, name: r.app.name, status: r.status }));
      wrap.classList.toggle("sbc", collapsed);
      renderRegion(side, sidebarView(model.dq, recent, collapsed));
    };
    const drawAll = () => { drawHead(); drawBody(); drawSide(); };
    drawAll();

    const jump = (key) => {
      const go = () => {
        const sx = el.querySelector("#sx-" + key);
        if (!sx) return;
        if (!sx.open) { sx.open = true; }
        const sel = qs(el, "select.jump"); if (sel) sel.value = key;
        sx.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      };
      if (fs().tab !== "sheet") { store.set({ fs: { ...fs(), tab: "sheet" } }); }
      // A find that hides the section is cleared first, so the jump always lands.
      if (!el.querySelector("#sx-" + key) && fs().find) { store.set({ fs: { ...fs(), find: "" } }); }
      go();
    };

    const offs = [];
    offs.push(tabKeys(el));
    offs.push(delegate(el, "click", "[data-act]", (ev, b) => {
      const act = b.getAttribute("data-act");
      if (act === "fs-back") navigate({ route: cameFrom, app: null, tab: null, view: null }, "push");
      else if (act === "crumb-domain") navigate({ route: "list", app: null, tab: null, view: null, q: "", f: { dom: [b.getAttribute("data-dom")] } }, "push");
      else if (act === "tab") store.set({ fs: { ...fs(), tab: b.getAttribute("data-v") } });
      else if (act === "jump") jump(b.getAttribute("data-sx"));
      else if (act === "side") { collapsed = !collapsed; saveSidebar(collapsed); drawSide(); }
      else if (act === "recent") navigate({ route: "app", app: b.getAttribute("data-id"), tab: null, view: null }, "push");
      else if (act === "copy") {
        const st = store.get();
        const link = linkFor(st.live ? st.live.serviceUrl : "", st) || (typeof location !== "undefined" ? location.href : "");
        copyText(link).then((ok) => toast(ok ? "Link copied" : "Copy blocked here. Copy the address from the browser bar.", ok ? undefined : { kind: "err" }));
      } else if (act === "contact") {
        const name = b.getAttribute("data-name");
        copyText(name).then((ok) => toast(ok ? "Name copied. Look " + name + " up in your directory." : "Copy blocked here.", ok ? undefined : { kind: "err" }));
      }
    }));
    offs.push(delegate(el, "change", "select.jump", (ev, sel) => jump(sel.value)));
    offs.push(delegate(el, "input", "input.fsearch", (ev, inp) => { store.set({ fs: { ...fs(), find: inp.value } }); }));
    // A section the viewer opens or closes is remembered. While a find forces sections open
    // nothing is saved, so the find never rewrites the viewer's choices.
    const onToggle = (ev) => {
      const d = ev.target;
      if (!d || !d.matches || !d.matches("details.fsx") || fs().find.trim()) return;
      const key = d.getAttribute("data-sx");
      if (d.open) closed.delete(key); else closed.add(key);
      saveClosed(closed);
    };
    el.addEventListener("toggle", onToggle, true);

    const offStore = store.subscribe((n, p) => {
      if (!ctx.current() || n.fs === p.fs) return;
      if (n.fs.tab !== p.fs.tab) { drawHead(); drawBody(); return; }
      if (n.fs.find !== p.fs.find) {
        const inp = qs(body, "input.fsearch");
        if (inp && inp.value !== n.fs.find) inp.value = n.fs.find;
        drawSecs();
      }
    });
    const offReg = register.subscribe(() => {
      const r = register.byId(id);
      if (!r || !ctx.current()) return;
      model = modelFor(r, store.get());
      drawAll();
    });
    return () => { offReg(); offStore(); offs.forEach((f) => f()); el.removeEventListener("toggle", onToggle, true); };
  },
};

registerPage("app", factsheetPage);
