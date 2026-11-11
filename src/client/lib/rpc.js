// Promisified google.script.run. Every endpoint answers {ok, data} or {ok:false, error,
// errorKind}; a failure rejects with an Error whose `kind` is the errorKind. The forbidden
// envelope also carries the owner's address (`contact`, `contactUrl`) for the access card.
// Derived from sidekick gas_shared/api.js at commit 77bcf22 (see VENDOR.md): no view-as, plus a
// small in-memory cache for calls whose answer only changes when something is saved.

export function call(name, params) {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined" || !google.script || !google.script.run) {
      reject(Object.assign(new Error("google.script.run is unavailable: open the app through its web address."), { kind: "error" }));
      return;
    }
    google.script.run
      .withSuccessHandler((res) => {
        if (res && res.ok) resolve(res.data);
        else {
          reject(Object.assign(new Error((res && res.error) || "Unknown server error"), {
            kind: (res && res.errorKind) || "error",
            contact: res && res.contact,
            contactUrl: res && res.contactUrl,
          }));
        }
      })
      .withFailureHandler((err) => {
        reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { kind: "error" }));
      })["api_" + name](params || {});
  });
}

const memo = new Map();

/** Like call, but the answer is kept until invalidate(). A failure is not kept. */
export function cached(name, params) {
  const key = name + ":" + JSON.stringify(params || {});
  if (memo.has(key)) return memo.get(key);
  const p = call(name, params).catch((e) => { memo.delete(key); throw e; });
  memo.set(key, p);
  return p;
}

/** Forget cached answers: all of them, or those of one endpoint. */
export function invalidate(name) {
  for (const k of Array.from(memo.keys())) if (!name || k.indexOf(name + ":") === 0) memo.delete(k);
}
