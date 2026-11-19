// Admin-published saved views: one Script Property section (JSON) with a generation counter, so a
// stale publish is a conflict. Reads are viewer-free (safe to cache). Writes run under the
// script lock. The app gates who may call publish/remove (the admin role); nothing here is
// per-viewer, and UserProperties is never used.

import { ApiError } from "./envelope";
import { withScriptLock } from "./lock";
import { PROP_MAX_BYTES, getProp, setProp, utf8ByteLength } from "./props";

export const SHARED_VIEWS_KEY = "SHARED_VIEWS";
export const SHARED_VIEWS_MAX = 40;
export const SHARED_VIEW_NAME_MAX = 60;

export interface SharedView { id: string; name: string; state: Record<string, unknown> }
export interface SharedViewsDoc { gen: number; views: SharedView[] }

export interface SharedViewsOptions {
  key?: string;
  props?: { get(key: string): string | null; set(key: string, value: string): void };
  lock?: <T>(fn: () => T) => T;
  maxViews?: number;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Error messages for one view; empty means valid. */
export function validateSharedView(v: unknown): string[] {
  if (!isPlain(v)) return ["A view must be an object."];
  const errs: string[] = [];
  if (typeof v.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(v.id)) errs.push("A view needs a short id of letters, digits, dash or underscore.");
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name || name.length > SHARED_VIEW_NAME_MAX) errs.push("A view name is 1 to " + SHARED_VIEW_NAME_MAX + " characters.");
  if (!isPlain(v.state)) errs.push("A view needs a state object.");
  return errs;
}

export function createSharedViews(opts: SharedViewsOptions = {}) {
  const key = opts.key ?? SHARED_VIEWS_KEY;
  const props = opts.props ?? { get: getProp, set: setProp };
  const lock = opts.lock ?? (<T>(fn: () => T): T => withScriptLock(fn));
  const maxViews = opts.maxViews ?? SHARED_VIEWS_MAX;

  function read(): SharedViewsDoc {
    const raw = props.get(key);
    if (!raw) return { gen: 0, views: [] };
    try {
      const d = JSON.parse(raw) as unknown;
      if (!isPlain(d) || !Array.isArray(d.views)) return { gen: 0, views: [] };
      const gen = Number.isInteger(d.gen) && (d.gen as number) >= 0 ? (d.gen as number) : 0;
      return { gen, views: (d.views as unknown[]).filter((v) => validateSharedView(v).length === 0) as SharedView[] };
    } catch {
      return { gen: 0, views: [] };
    }
  }

  function commit(base: unknown, change: (views: SharedView[]) => SharedView[]): SharedViewsDoc {
    if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
      throw new ApiError("error", "Reload the views before saving: the change has no starting point.");
    }
    return lock(() => {
      const cur = read();
      if (cur.gen !== base) {
        throw new ApiError("conflict", "Someone else changed the shared views. Reload to see their changes, then try again.");
      }
      const views = change(cur.views);
      if (views.length > maxViews) throw new ApiError("error", "At most " + maxViews + " shared views can be kept.");
      const doc: SharedViewsDoc = { gen: cur.gen + 1, views };
      const json = JSON.stringify(doc);
      const bytes = utf8ByteLength(json);
      if (bytes > PROP_MAX_BYTES) {
        throw new ApiError("error", "That is too large to store (" + bytes + " of " + PROP_MAX_BYTES + " bytes in " + key + ").");
      }
      props.set(key, json);
      return doc;
    });
  }

  return {
    list: read,
    /** Add a view, or replace the one with the same id. */
    publish(req: { view: unknown; baseGen: unknown }): SharedViewsDoc {
      const errs = validateSharedView(req ? req.view : undefined);
      if (errs.length) throw new ApiError("error", errs.join(" "));
      const v = req.view as SharedView;
      const view: SharedView = { id: v.id, name: v.name.trim(), state: JSON.parse(JSON.stringify(v.state)) };
      return commit(req.baseGen, (all) => {
        const i = all.findIndex((x) => x.id === view.id);
        if (all.some((x) => x.id !== view.id && x.name.toLowerCase() === view.name.toLowerCase())) {
          throw new ApiError("error", "A shared view with that name exists.");
        }
        return i < 0 ? [...all, view] : all.map((x, j) => (j === i ? view : x));
      });
    },
    remove(req: { id: unknown; baseGen: unknown }): SharedViewsDoc {
      return commit(req ? req.baseGen : undefined, (all) => {
        if (!all.some((x) => x.id === (req ? req.id : undefined))) throw new ApiError("error", "That shared view no longer exists.");
        return all.filter((x) => x.id !== req.id);
      });
    },
  };
}

export type SharedViewsStore = ReturnType<typeof createSharedViews>;
