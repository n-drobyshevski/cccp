// The register in the browser. The whole payload is decoded once; status, completeness and
// search text are derived once per load (and again after a rules or display save). Display
// settings hide apps from every page, but a hidden app still opens by its link.
import { completeness } from "../../domain/quality";
import { decodeRegister } from "../../domain/payload";
import { makeRow } from "../../domain/facets";
import { evaluateAll } from "../../domain/rules";
import * as rpc from "../lib/rpc.js";

const EOL = ["END_OF_LIFE", "END_OF_SUPPORT"];

const lifecycleKey = (v) => String(v == null ? "" : v).trim().toUpperCase().replace(/[\s-]+/g, "_");

/** Whether the Display settings hide this application. */
export function isHidden(app, display) {
  const d = display || {};
  const prefix = String(d.hidePrefix || "").trim().toLowerCase();
  if (prefix && String(app.name || "").toLowerCase().indexOf(prefix) === 0) return true;
  return !!d.hideEol && EOL.indexOf(lifecycleKey(app.lifecycle)) >= 0;
}

/**
 * Pure: rows for every application, the visible subset and the hidden count. `ctx` is
 * {rules, display, today}. Marks cccp:derive in the performance timeline.
 */
export function derive(apps, ctx) {
  let t0 = null;
  try { t0 = performance.now(); } catch (e) { /* no timeline in this environment */ }
  const status = evaluateAll(apps, ctx.rules, ctx.today);
  const rows = new Array(apps.length);
  const byId = new Map();
  const visible = [];
  for (let i = 0; i < apps.length; i++) {
    const a = apps[i];
    const r = makeRow(a, status[i], completeness(a).pct);
    rows[i] = r;
    byId.set(a.id, r);
    if (!isHidden(a, ctx.display)) visible.push(r);
  }
  if (t0 !== null) {
    try { performance.measure("cccp:derive", { start: t0, end: performance.now(), detail: { apps: apps.length } }); } catch (e) { /* ignore */ }
  }
  return { rows, byId, visible, hiddenCount: rows.length - visible.length };
}

let apps = [];
let derived = { rows: [], byId: new Map(), visible: [], hiddenCount: 0 };
let meta = { loadedAt: "", dataVersion: 0 };
let loaded = false;
let ctx = null;
const subs = new Set();

function emit() {
  for (const fn of Array.from(subs)) fn();
}

/** Decode a payload and derive everything. `context` is {rules, display, today}. */
export function load(payload, context) {
  apps = decodeRegister(payload);
  meta = { loadedAt: payload.loadedAt, dataVersion: payload.dataVersion };
  ctx = context;
  derived = derive(apps, ctx);
  loaded = true;
  emit();
  return derived;
}

/** Derive again from the decoded records after a rules or display save. */
export function rederive(context) {
  ctx = { ...ctx, ...context };
  derived = derive(apps, ctx);
  emit();
  return derived;
}

/**
 * Get the register: the inline payload when the page carried one, else api_getRegister (the
 * caller shows a skeleton meanwhile). Resolves the derived register.
 */
export function ready(context, inlinePayload) {
  if (inlinePayload) return Promise.resolve(load(inlinePayload, context));
  return rpc.call("getRegister").then((p) => load(p, context));
}

export const isLoaded = () => loaded;
export const allRows = () => derived.rows;
export const visibleRows = () => derived.visible;
export const hiddenCount = () => derived.hiddenCount;
export const byId = (id) => derived.byId.get(id) || null;
export const loadedMeta = () => meta;
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

/** Test seam. */
export function reset() {
  apps = [];
  derived = { rows: [], byId: new Map(), visible: [], hiddenCount: 0 };
  loaded = false;
  ctx = null;
}
