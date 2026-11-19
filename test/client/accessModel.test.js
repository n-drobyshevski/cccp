// What the Access panel decides, on the kit's accessModel (which replaced the vendored gas_hub
// accessModel) and the few pure helpers access.js wraps around it.
//
// The authorization itself is `test/server/accessAdmin.test.ts` (server-side, where the boundary
// is). This file covers the panel's own decisions, whose failure mode is quieter: a control that
// looks like it worked. Every behaviour the vendored model's tests pinned is kept below; the ones
// that differ because the kit model is stricter or keeps the owner in the draft say so.

import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES, accessDiff, accessPatch, addEmails, createDraft, removeEmail,
} from "@gas-kit/ui/components/accessModel.js";
import {
  ADD_REJECTION, editable, initials, isDirty, keepers, modeConfirm, outsideDomain, pendingSaves, rejectionKey, removals,
} from "../../src/client/pages/settings/access.js";

const info = {
  canEditUsers: true,
  canEditAdmins: true,
  owner: "owner@example.com",
  domain: "example.com",
  users: ["owner@example.com", "listed@example.com", "other@example.com"],
  admins: ["admin@example.com"],
};
const draftOf = (i = info) => createDraft({ owner: i.owner, users: i.users, admins: i.admins, mode: "list" });
/** The first refusal of one typed address, in the words the panel shows. */
const refuse = (draft, list, text) => {
  const r = addEmails(draft, list, text, draft.owner).rejected[0];
  return r ? rejectionKey(r, draft.owner) : null;
};

describe("the owner's row", () => {
  it("is lifted out of the editable list", () => {
    // Leaving them in would put a remove button on the one row that cannot be removed: they are
    // admitted by identity, so deleting them changes nothing except what the list appears to say.
    const d = draftOf();
    expect(editable(d, "users")).toEqual(["listed@example.com", "other@example.com"]);
    expect(d.owner).toBe("owner@example.com");
  });

  it("matches regardless of case, and cannot be removed", () => {
    const d = createDraft({ owner: "Owner@Example.com", users: ["owner@example.com", "a@example.com"] });
    expect(d.owner).toBe("owner@example.com");
    const r = removeEmail(d, "users", "OWNER@example.com");
    expect(r.ok).toBe(false);
    expect(r.draft).toBe(d);
    expect(removeEmail(d, "users", "a@example.com").ok).toBe(true);
  });

  it("cannot be added back as an ordinary person", () => {
    expect(refuse(draftOf(), "users", "owner@example.com")).toBe("already-the-owner");
    expect(refuse(draftOf(), "admins", "Owner@example.com")).toBe("already-the-owner");
  });

  it("survives a payload with no roster at all", () => {
    // What a non-editor gets: {canEditUsers:false}. The panel returns before reaching here, but a
    // model that threw on it would turn a normal outcome into a page error.
    const d = createDraft({});
    expect(d.users).toEqual([]);
    expect(d.admins).toEqual([]);
    expect(createDraft(null).users).toEqual([]);
  });
});

describe("an address outside the domain grants nothing", () => {
  it("flags it", () => {
    // It cannot match a Google account this app can see, so adding it is a no-op the reader
    // would otherwise walk away believing.
    expect(outsideDomain("x@other.com", "example.com")).toBe(true);
    expect(outsideDomain("x@example.com", "example.com")).toBe(false);
    expect(outsideDomain("X@EXAMPLE.COM", "example.com")).toBe(false);
  });

  it("flags nothing when the domain is unknown", () => {
    // Better to say nothing than to mark every address as suspect.
    expect(outsideDomain("x@other.com", "")).toBe(false);
  });

  it("does not REFUSE it", () => {
    // Flagged, not blocked: the server accepts it, and the panel tells the reader what will
    // happen rather than deciding for them.
    expect(addEmails(draftOf(), "users", "x@other.com", info.owner).added).toEqual(["x@other.com"]);
  });
});

describe("what the panel will not accept", () => {
  it("refuses an entry that is not an address, as the server does", () => {
    // So the same edit is not accepted here and refused there, which would leave the reader
    // unsure which entry was the bad one. (The kit model is stricter than the vendored one, which
    // took anything with an @: it wants a dotted domain, as the server's address check does.)
    expect(refuse(draftOf(), "users", "notanemail")).toBe("not-an-address");
    expect(refuse(draftOf(), "users", "a@localhost")).toBe("not-an-address");
    expect(ADD_REJECTION["not-an-address"]).toMatch(/email address/);
  });

  it("refuses a duplicate, without regard to case", () => {
    expect(refuse(draftOf(), "users", "LISTED@example.com")).toBe("already-listed");
    expect(refuse(draftOf(), "admins", "admin@example.com")).toBe("already-listed");
  });

  it("does nothing for an empty box", () => {
    const r = addEmails(draftOf(), "users", "   ", info.owner);
    expect(r.added).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("normalizes what it does accept, and takes several pasted at once", () => {
    expect(addEmails(draftOf(), "users", "  A@X.com ", info.owner).added).toEqual(["a@x.com"]);
    expect(addEmails(draftOf(), "users", "a@x.com; b@x.com\nc@x.com", info.owner).added).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("stops at a full list, saying so", () => {
    let d = createDraft({ owner: info.owner });
    const many = Array.from({ length: MAX_ENTRIES }, (_, i) => "p" + i + "@example.com").join(" ");
    d = addEmails(d, "users", many, info.owner).draft;
    expect(refuse(d, "users", "one-more@example.com")).toBe("full");
    expect(ADD_REJECTION.full).toMatch(/full/);
  });
});

describe("a save says what it will take away", () => {
  // `base` is the roster known to be ON DISK, and it moves on every save.
  const base = draftOf();
  const without = (d, list, e) => removeEmail(d, list, e).draft;

  it("names the people who lose access", () => {
    // Counting them would be enough for a dialog and not enough for a decision: removing someone
    // locks them out on their very next request.
    let d = without(base, "users", "other@example.com");
    d = without(d, "admins", "admin@example.com");
    expect(removals(base, d)).toEqual(["other@example.com", "admin@example.com"]);
  });

  it("still confirms a removal made AFTER an earlier save", () => {
    // THE DEFECT THIS EXISTS FOR, caught in the browser: comparing against the payload the page
    // loaded with, never refreshed, makes the first removal confirmed and every later one silent.
    // The baseline has to move when the disk does.
    const loaded = createDraft({ owner: info.owner });
    const afterSave = createDraft({ owner: info.owner, users: ["colleague@example.com", "outsider@other.com"] });
    const now = without(afterSave, "users", "outsider@other.com");
    expect(removals(loaded, now)).toEqual([]);
    expect(removals(afterSave, now)).toEqual(["outsider@other.com"]);
  });

  it("never counts the owner as a removal", () => {
    expect(removals(base, base)).toEqual([]);
    const gone = removeEmail(base, "users", info.owner);
    expect(removals(base, gone.draft)).toEqual([]);
  });

  it("sees an addition as no removal at all", () => {
    expect(removals(base, addEmails(base, "users", "new@example.com", info.owner).draft)).toEqual([]);
  });

  it("diffs two drafts that differ only in the mode as no change to the lists", () => {
    // The mode saves on its own (saveAccessMode, after a confirmation), so it never counts as an unsaved list edit.
    expect(removals(base, { ...base, mode: "org" })).toEqual([]);
    expect(accessDiff(base, base).count).toBe(0);
  });
});

describe("only what changed is sent", () => {
  const base = draftOf();

  it("sends nothing when nothing moved", () => {
    expect(isDirty(base, draftOf())).toBe(false);
    expect(pendingSaves(base, draftOf(), true)).toEqual({ users: false, admins: false });
    expect(accessPatch(base, draftOf())).toEqual({});
  });

  it("never sends the admins list from an admin's panel", () => {
    // An admin cannot change it, so sending it, even unchanged, would earn a refusal from
    // saveAdmins for a no-op: an error about something they never touched.
    const d = addEmails(base, "users", "new@example.com", info.owner).draft;
    expect(pendingSaves(base, d, false)).toEqual({ users: true, admins: false });
    const forced = addEmails(d, "admins", "x@example.com", info.owner).draft;
    expect(pendingSaves(base, forced, false)).toEqual({ users: true, admins: false });
  });

  it("sends the admins list when the owner changed it", () => {
    const d = addEmails(base, "admins", "second@example.com", info.owner).draft;
    expect(isDirty(base, d)).toBe(true);
    expect(pendingSaves(base, d, true)).toEqual({ users: false, admins: true });
  });
});

// ---- CCCP additions: the Access tab's own model, org mode and the confirmations.

describe("org mode and the switch back to list", () => {
  it("counts who keeps access once each: the owner, the admins and the people listed", () => {
    const k = keepers({ owner: "Owner@example.com", users: ["owner@example.com", "a@example.com"], admins: ["a@example.com", "b@example.com"] });
    expect(k).toEqual(["owner@example.com", "a@example.com", "b@example.com"]);
    expect(keepers(null)).toEqual([]);
  });

  it("the org confirmation names the domain", () => {
    const c = modeConfirm("org", { domain: "example.com" });
    expect(c.title).toContain("example.com");
    expect(c.body).toContain("@example.com");
    expect(c.danger).toBe(false);
  });

  it("the list confirmation says how many people keep access", () => {
    const c = modeConfirm("list", { domain: "example.com", owner: "o@example.com", users: ["a@example.com"], admins: ["b@example.com"] });
    expect(c.body).toMatch(/^3 people keep access/);
    expect(modeConfirm("list", { owner: "o@example.com", users: [], admins: [] }).body).toMatch(/^1 person keeps access/);
  });

  it("initials come from the local part", () => {
    expect(initials("jane.doe@x.com")).toBe("JD");
    expect(initials("solo@x.com")).toBe("SO");
    expect(initials("")).toBe("?");
  });
});
