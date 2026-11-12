// The refresh bar's flag: true while data reloads under a page that keeps showing the old data.
// Calls may nest (a reload that ends in a bootstrap), so it counts.
import { store } from "./store.js";

let depth = 0;

/** Run `fn` with the thin bar under the app bar showing; resolves what `fn` resolves. */
export async function withRefresh(fn) {
  depth++;
  store.set({ refreshing: true });
  try {
    return await fn();
  } finally {
    depth--;
    if (depth === 0) store.set({ refreshing: false });
  }
}
