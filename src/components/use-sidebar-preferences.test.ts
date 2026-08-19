// Unit tests for readVisibleHrefs.
//
// The load-bearing property here is *reference stability*, not the parsed value.
// `useSyncExternalStore` compares each snapshot to the previous one with
// `Object.is`; if the getSnapshot function returns a fresh array every call,
// React believes the store changed on every check and reschedules a sync
// re-render forever, throwing React error #185 ("Maximum update depth
// exceeded"). Because AppSidebar calls useSidebarPreferences, that took down
// every page under (app) in production. It only reproduced where the user had
// preferences saved, which is why localhost (separate localStorage per origin,
// nothing stored) looked fine.
//
// Run: ./node_modules/.bin/tsx --test "src/components/use-sidebar-preferences.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";

import { readVisibleHrefs, SIDEBAR_PREFS_KEY } from "./use-sidebar-preferences";

// readVisibleHrefs reads window.localStorage when *called*, not at import time,
// so stubbing at module scope here is early enough for every test below.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
    },
  },
  writable: true,
  configurable: true,
});

function store(value: string[] | null) {
  if (value === null) stored.delete(SIDEBAR_PREFS_KEY);
  else stored.set(SIDEBAR_PREFS_KEY, JSON.stringify(value));
}

test("repeated reads of a saved list return the identical reference", () => {
  store(["/home", "/search", "/my-tasks"]);
  const first = readVisibleHrefs();
  assert.deepEqual(first, ["/home", "/search", "/my-tasks"]);
  // The regression: parsing per call returned an equal-but-distinct array.
  assert.ok(Object.is(first, readVisibleHrefs()));
  assert.ok(Object.is(first, readVisibleHrefs()));
});

test("a changed stored value produces a new, then again stable, snapshot", () => {
  store(["/home", "/search"]);
  const before = readVisibleHrefs();

  store(["/home"]);
  const after = readVisibleHrefs();

  assert.ok(!Object.is(before, after), "a real change must be observable");
  assert.deepEqual(after, ["/home"]);
  assert.ok(Object.is(after, readVisibleHrefs()), "and stable once more");
});

test("no saved preference reads as null, stably", () => {
  store(null);
  assert.equal(readVisibleHrefs(), null);
  assert.ok(Object.is(readVisibleHrefs(), readVisibleHrefs()));
});

test("malformed JSON reads as null rather than throwing", () => {
  stored.set(SIDEBAR_PREFS_KEY, "{not json");
  assert.equal(readVisibleHrefs(), null);
});

test("a non-array payload reads as null", () => {
  stored.set(SIDEBAR_PREFS_KEY, JSON.stringify({ home: true }));
  assert.equal(readVisibleHrefs(), null);
});

test("non-string entries are dropped, and the result stays stable", () => {
  stored.set(SIDEBAR_PREFS_KEY, JSON.stringify(["/home", 42, null, "/search"]));
  const hrefs = readVisibleHrefs();
  assert.deepEqual(hrefs, ["/home", "/search"]);
  assert.ok(Object.is(hrefs, readVisibleHrefs()));
});
