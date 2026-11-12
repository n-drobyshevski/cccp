// The shell search's behaviour, apart from its markup: typing on the Inventory filters live after a
// short pause; on any other page nothing happens until Enter, which opens the Inventory with that
// query. The search keeps what has been typed and not yet applied (the draft), so a redraw of the
// bar never loses it. Pure of the DOM: the store, the URL writers and the timers are passed in.
export const SEARCH_DEBOUNCE_MS = 120;
/** Routes whose address carries the list query; the search shows q on these. */
export const QUERY_ROUTES = ["list"];
const PAGE_STEP = 50;

export function createSearch(env) {
  const wait = env.setTimeout || setTimeout;
  const stop = env.clearTimeout || clearTimeout;
  let draft = null;
  let timer = 0;

  const apply = (value) => {
    stop(timer);
    const s = env.state();
    draft = null;
    if (s.route === "list") env.replace({ q: value, limit: PAGE_STEP });
    else env.navigate({ route: "list", app: null, tab: null, view: null, q: value, f: QUERY_ROUTES.indexOf(s.route) >= 0 ? s.f : {}, limit: PAGE_STEP }, "push");
  };

  return {
    /** Every keystroke. */
    type(value) {
      draft = value;
      stop(timer);
      if (env.state().route === "list") timer = wait(() => apply(value), SEARCH_DEBOUNCE_MS);
    },
    /** Enter: apply now, wherever the viewer is. */
    enter: apply,
    /** The route changed: drop a pending live apply and the draft. */
    reset() { stop(timer); draft = null; },
    /** The text the field should show: the draft, else q on a query page, else empty. */
    value(s) { return draft !== null ? draft : QUERY_ROUTES.indexOf(s.route) >= 0 ? s.q : ""; },
    get draft() { return draft; },
  };
}
