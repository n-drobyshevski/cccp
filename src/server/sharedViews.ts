// Shared saved views: the SHARED_VIEWS Script Property, at most 40 views and 8000 bytes,
// written only by admins (api.ts re-checks the role; the endpoint table gates it first).
// Each write is under the script lock and bumps VIEWS_GEN (not CFG_GEN, the settings save base), because the bootstrap core carries
// the list. Personal views never come here: they live in the viewer's own localStorage.

import { cleanView, validateSharedViews, validateView } from "../domain/viewState";
import type { SavedView } from "../domain/types";
import { ApiError, getJsonProp, putJsonProp, withScriptLock } from "@gas-kit/server";
import { PROP_KEYS } from "./config";
import { bumpViewsGen } from "./serverCache";

export const MAX_VIEWS = 40;

/** The stored list, each view cleaned; a malformed entry is dropped rather than shown. */
export function listSharedViews(): SavedView[] {
  const raw = getJsonProp<unknown>(PROP_KEYS.sharedViews, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(cleanView).filter((v) => v.id !== "" && v.name !== "");
}

/**
 * A new view id: 10 hex characters of a random UUID, unique within the list. Ids are written once,
 * when a view is first saved, and stored with it; nothing derives an id again, so the ids already
 * saved (10 hex characters from the old name-and-time hash) stay valid, and the clients' links
 * and localStorage that name them keep working.
 */
function newId(taken: Set<string>): string {
  let id = Utilities.getUuid().replace(/-/g, "").slice(0, 10);
  while (taken.has(id)) id = Utilities.getUuid().replace(/-/g, "").slice(0, 10);
  return id;
}

/**
 * Add a view, or replace the one with the same id. The scope is forced to shared and the
 * date is stamped here, never taken from the caller. The author is logged, not stored: the
 * list is part of the cached core that every viewer receives.
 */
export function saveSharedView(input: unknown, actor: string): { views: SavedView[]; id: string } {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const candidate = { ...raw, scope: "shared" };
  const errors = validateView(candidate);
  if (errors.length) throw new ApiError("error", errors.join(" "));
  return withScriptLock(() => {
    const list = listSharedViews();
    const clean = cleanView(candidate);
    const at = list.findIndex((v) => v.id === clean.id && clean.id !== "");
    if (at < 0 && list.length >= MAX_VIEWS) throw new ApiError("error", "At most " + MAX_VIEWS + " shared views can be kept. Delete one first.");
    const { by: _by, ...rest } = clean;
    const view: SavedView = { ...rest, scope: "shared", id: at >= 0 ? clean.id : newId(new Set(list.map((v) => v.id))), at: new Date().toISOString().slice(0, 10) };
    const next = at >= 0 ? list.map((v, i) => (i === at ? view : v)) : list.concat(view);
    const problems = validateSharedViews(next);
    if (problems.length) throw new ApiError("error", problems.join(" "));
    putJsonProp(PROP_KEYS.sharedViews, next);
    bumpViewsGen();
    console.log(JSON.stringify({ sharedView: "saved", actor, id: view.id, name: view.name }));
    return { views: next, id: view.id };
  });
}

export function deleteSharedView(id: unknown, actor: string): { views: SavedView[] } {
  if (typeof id !== "string" || id === "") throw new ApiError("error", "Choose a shared view to delete.");
  return withScriptLock(() => {
    const list = listSharedViews();
    const next = list.filter((v) => v.id !== id);
    if (next.length === list.length) throw new ApiError("error", "That shared view no longer exists.");
    putJsonProp(PROP_KEYS.sharedViews, next);
    bumpViewsGen();
    console.log(JSON.stringify({ sharedView: "deleted", actor, id }));
    return { views: next };
  });
}
