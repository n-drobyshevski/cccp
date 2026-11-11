// Shared saved views: the SHARED_VIEWS Script Property, at most 40 views and 8000 bytes,
// written only by admins (api.ts re-checks the role; the endpoint table gates it first).
// Each write is under the script lock and bumps CFG_GEN, because the bootstrap core carries
// the list. Personal views never come here: they live in the viewer's own localStorage.

import { sha1Hex } from "../vendor/gas_shared/domain/sha1";
import { cleanView, validateSharedViews, validateView } from "../domain/viewState";
import type { SavedView } from "../domain/types";
import { withScriptLock } from "./locks";
import { getJsonProp, PROP_KEYS, putJsonProp } from "./props";
import { bumpCfgGen } from "./serverCache";

export const MAX_VIEWS = 40;

/** The stored list, each view cleaned; a malformed entry is dropped rather than shown. */
export function listSharedViews(): SavedView[] {
  const raw = getJsonProp<unknown>(PROP_KEYS.sharedViews, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(cleanView).filter((v) => v.id !== "" && v.name !== "");
}

function newId(name: string, taken: Set<string>): string {
  let ts = Date.now();
  let id = sha1Hex(name + ts).slice(0, 10);
  while (taken.has(id)) id = sha1Hex(name + ++ts).slice(0, 10);
  return id;
}

/**
 * Add a view, or replace the one with the same id. The scope is forced to shared and the
 * author and date are stamped here, never taken from the caller.
 */
export function saveSharedView(input: unknown, actor: string): { views: SavedView[]; id: string } {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const candidate = { ...raw, scope: "shared" };
  const errors = validateView(candidate);
  if (errors.length) throw new Error(errors.join(" "));
  return withScriptLock(() => {
    const list = listSharedViews();
    const clean = cleanView(candidate);
    const at = list.findIndex((v) => v.id === clean.id && clean.id !== "");
    if (at < 0 && list.length >= MAX_VIEWS) throw new Error("At most " + MAX_VIEWS + " shared views can be kept. Delete one first.");
    const view: SavedView = { ...clean, scope: "shared", id: at >= 0 ? clean.id : newId(clean.name, new Set(list.map((v) => v.id))), by: actor, at: new Date().toISOString().slice(0, 10) };
    const next = at >= 0 ? list.map((v, i) => (i === at ? view : v)) : list.concat(view);
    const problems = validateSharedViews(next);
    if (problems.length) throw new Error(problems.join(" "));
    putJsonProp(PROP_KEYS.sharedViews, next);
    bumpCfgGen();
    console.log(JSON.stringify({ sharedView: "saved", actor, id: view.id, name: view.name }));
    return { views: next, id: view.id };
  });
}

export function deleteSharedView(id: unknown, actor: string): { views: SavedView[] } {
  if (typeof id !== "string" || id === "") throw new Error("Choose a shared view to delete.");
  return withScriptLock(() => {
    const list = listSharedViews();
    const next = list.filter((v) => v.id !== id);
    if (next.length === list.length) throw new Error("That shared view no longer exists.");
    putJsonProp(PROP_KEYS.sharedViews, next);
    bumpCfgGen();
    console.log(JSON.stringify({ sharedView: "deleted", actor, id }));
    return { views: next };
  });
}
