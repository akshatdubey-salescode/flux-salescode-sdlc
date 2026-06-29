// Unit tests for the KekaDirectory reverse index (directReports / managerEmails)
// that team provisioning relies on. Pure — constructs the directory in-memory,
// no DB.
// Run: ./node_modules/.bin/tsx --test src/lib/keka/directory.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { KekaDirectory, type KekaDirectoryEntry } from "./directory";

function entry(o: {
  email: string;
  name?: string;
  managerEmail?: string | null;
  userId?: string | null;
}): KekaDirectoryEntry {
  return {
    kekaEmployeeId: o.email,
    email: o.email,
    displayName: o.name ?? o.email,
    jobTitle: null,
    department: null,
    managerKekaId: null,
    managerName: null,
    managerEmail: o.managerEmail ?? null,
    userId: o.userId ?? null,
    joiningDate: null,
  };
}

// boss → {alice, bob}; alice → {carol}; dave reports to nobody.
function buildDir(): KekaDirectory {
  return new KekaDirectory(
    [
      entry({ email: "boss@x.com", name: "Boss", managerEmail: "boss@x.com" }), // self-report (org top)
      entry({ email: "alice@x.com", name: "Alice", managerEmail: "boss@x.com", userId: "alice@x.com" }),
      entry({ email: "bob@x.com", name: "Bob", managerEmail: "BOSS@x.com" }), // mixed-case manager email
      entry({ email: "carol@x.com", name: "Carol", managerEmail: "alice@x.com" }),
      entry({ email: "dave@x.com", name: "Dave", managerEmail: null }),
    ],
    []
  );
}

test("directReports returns a manager's immediate reports", () => {
  const dir = buildDir();
  const emails = dir.directReports("boss@x.com").map((e) => e.email).sort();
  assert.deepEqual(emails, ["alice@x.com", "bob@x.com"]);
});

test("directReports is case-insensitive on both sides", () => {
  const dir = buildDir();
  // Query in upper-case; bob's managerEmail was stored mixed-case.
  const emails = dir.directReports("BOSS@X.COM").map((e) => e.email).sort();
  assert.deepEqual(emails, ["alice@x.com", "bob@x.com"]);
});

test("directReports excludes a self-report (org top isn't its own report)", () => {
  const dir = buildDir();
  const emails = dir.directReports("boss@x.com").map((e) => e.email);
  assert.ok(!emails.includes("boss@x.com"));
});

test("directReports returns [] for a non-manager or unknown email", () => {
  const dir = buildDir();
  assert.deepEqual(dir.directReports("carol@x.com"), []); // a leaf
  assert.deepEqual(dir.directReports("nobody@x.com"), []); // unknown
  assert.deepEqual(dir.directReports(null), []);
  assert.deepEqual(dir.directReports(undefined), []);
});

test("directReports surfaces the userId link for non-Flux detection", () => {
  const dir = buildDir();
  const reports = dir.directReports("boss@x.com");
  const alice = reports.find((r) => r.email === "alice@x.com");
  const bob = reports.find((r) => r.email === "bob@x.com");
  assert.equal(alice?.userId, "alice@x.com"); // linked Flux user
  assert.equal(bob?.userId, null); // not a Flux user
});

test("managerEmails lists every email with at least one report (lowercased)", () => {
  const dir = buildDir();
  const managers = dir.managerEmails().sort();
  // boss@x.com (alice, bob), alice@x.com (carol). dave has no manager so isn't
  // a key; carol/bob/dave aren't managers.
  assert.deepEqual(managers, ["alice@x.com", "boss@x.com"]);
});
