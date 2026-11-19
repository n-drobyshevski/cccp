// Personal saved views over the kit's storage: a view is {id, name, state}, where state is plain
// JSON the app defines (filters, sort, columns). Kept in this browser only. A storage refusal
// makes list return [] and every write return null, so a caller hides the control (check
// `available`). Pure helpers: isChanged compares the live state with a view's saved state.

export const VIEWS_MAX = 20;
export const VIEW_NAME_MAX = 60;

/** @typedef {{id: string, name: string, state: any}} SavedView */

/** Key order does not matter: objects are compared by sorted keys, arrays by position unless the app passes its own canon. */
/** @param {any} v @returns {any} */
function canon(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canon(v[k]);
    return o;
  }
  return v;
}

/**
 * True when the current state differs from the view's saved state. A missing view is never
 * "changed". Compared deeply, ignoring key order and undefined members; null and undefined both
 * read as an empty state. Pass `canon` (state to state) to sort multi-select values and the like.
 * @param {any} current
 * @param {SavedView | null | undefined} view
 * @param {(state: any) => any} [custom]
 * @returns {boolean}
 */
export function isChanged(current, view, custom) {
  if (!view) return false;
  const f = typeof custom === "function" ? custom : (/** @type {any} */ x) => x;
  const norm = (/** @type {any} */ x) => canon(f(x == null ? {} : x));
  return JSON.stringify(norm(current)) !== JSON.stringify(norm(view.state));
}

/** @param {unknown} name @returns {{name: string, error: string}} */
export function checkViewName(name) {
  const n = String(name == null ? "" : name).trim().replace(/\s+/g, " ");
  if (!n) return { name: "", error: "Give the view a name." };
  if (n.length > VIEW_NAME_MAX) return { name: n, error: "Use at most " + VIEW_NAME_MAX + " characters." };
  return { name: n, error: "" };
}

/**
 * @param {{get: (k: string) => any, set: (k: string, v: unknown) => boolean, readonly available: boolean}} storage
 * @param {{key?: string, max?: number}} [opts] key defaults to "views"
 */
export function createViewStore(storage, opts) {
  const key = (opts && opts.key) || "views";
  const max = (opts && opts.max) || VIEWS_MAX;

  /** @returns {SavedView[]} */
  function list() {
    const raw = storage.get(key);
    if (!Array.isArray(raw)) return [];
    return raw.filter((v) => v && typeof v.id === "string" && typeof v.name === "string" && "state" in v);
  }
  /** @param {SavedView[]} next */
  const write = (next) => (storage.set(key, next) ? next : null);
  /** @param {any} state @returns {any} undefined when the state is not JSON */
  const clone = (state) => {
    try {
      const t = JSON.stringify(state == null ? {} : state);
      return t === undefined ? undefined : JSON.parse(t);
    } catch (e) { return undefined; }
  };
  const GONE = "That view no longer exists.";
  const BAD = "That view state cannot be saved.";
  const newId = () => "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    max,
    get available() { return storage.available; },
    list,
    /** @param {string} name @param {any} state @returns {{view?: SavedView, error?: string} | null} null when storage refuses */
    save(name, state) {
      if (!storage.available) return null;
      const c = checkViewName(name);
      if (c.error) return { error: c.error };
      const all = list();
      if (all.length >= max) return { error: "You can keep up to " + max + " views. Delete one first." };
      if (all.some((v) => v.name.toLowerCase() === c.name.toLowerCase())) return { error: "A view with that name exists." };
      const st = clone(state);
      if (st === undefined) return { error: BAD };
      const view = { id: newId(), name: c.name, state: st };
      return write([...all, view]) ? { view } : null;
    },
    /** Replace the state of an existing view (the Save action). @param {string} id @param {any} state @returns {{view?: SavedView, error?: string} | null} null when storage refuses */
    update(id, state) {
      if (!storage.available) return null;
      const all = list();
      const i = all.findIndex((v) => v.id === id);
      if (i < 0) return { error: GONE };
      const st = clone(state);
      if (st === undefined) return { error: BAD };
      const view = { ...all[i], state: st };
      return write(all.map((v, j) => (j === i ? view : v))) ? { view } : null;
    },
    /** @param {string} id @param {string} name @returns {{view?: SavedView, error?: string} | null} */
    rename(id, name) {
      if (!storage.available) return null;
      const c = checkViewName(name);
      if (c.error) return { error: c.error };
      const all = list();
      const i = all.findIndex((v) => v.id === id);
      if (i < 0) return { error: GONE };
      if (all.some((v, j) => j !== i && v.name.toLowerCase() === c.name.toLowerCase())) return { error: "A view with that name exists." };
      const view = { ...all[i], name: c.name };
      return write(all.map((v, j) => (j === i ? view : v))) ? { view } : null;
    },
    /** @param {string} id @returns {boolean} */
    remove(id) {
      const all = list();
      if (!all.some((v) => v.id === id)) return false;
      return write(all.filter((v) => v.id !== id)) !== null;
    },
  };
}
