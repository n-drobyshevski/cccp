// A localStorage stand-in for the node tests. The kit's createStorage reads globalThis.localStorage
// (in a browser that is window.localStorage), and lib/storage.js keeps one kit storage for the run,
// so each install resets it and the next call probes the fake.
import { __resetStorageForTest } from "../../src/client/lib/storage.js";

export function installLocalStorage(impl) {
  Object.defineProperty(globalThis, "localStorage", { value: impl, configurable: true, writable: true });
  __resetStorageForTest();
}

/** A storage that throws on access to window.localStorage itself (the browser's refusal). */
export function installRefusingLocalStorage() {
  Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
  __resetStorageForTest();
}

export function removeLocalStorage() {
  delete globalThis.localStorage;
  __resetStorageForTest();
}
