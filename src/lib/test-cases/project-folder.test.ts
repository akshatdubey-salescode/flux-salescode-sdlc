// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/project-folder.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { folderCandidates } from "./project-folder";

test("the project's name comes first, then the name with its Jira key, then numbered", () => {
  const c = folderCandidates("Coke Thainamthip", "CT");
  assert.deepEqual(c.slice(0, 4), ["Coke_Thainamthip", "Coke_Thainamthip-CT", "Coke_Thainamthip-CT-2", "Coke_Thainamthip-CT-3"]);
  assert.equal(new Set(c).size, c.length, "no repeats");
});

test("awkward names still give safe folder names", () => {
  assert.equal(folderCandidates("Kirana King / DMS (v2)", "KK")[0], "Kirana_King_DMS_v2");
  assert.equal(folderCandidates("../../etc", "X")[0], "etc");
  assert.equal(folderCandidates("   ", "X")[0], "x", "an empty name falls back to something");
  assert.ok(folderCandidates("Ünïcödé Projéct", "U")[0].match(/^[A-Za-z0-9._-]+$/));
});
