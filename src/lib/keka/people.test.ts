// Unit tests for the Keka-only people gate. Covers the in-memory half
// (keepKekaPeople) and the shape of the SQL half, which is what most callers
// use. Pure — no DB.
// Run: ./node_modules/.bin/tsx --test src/lib/keka/people.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { KekaDirectory, type KekaDirectoryEntry } from "./directory";
import { isKekaPerson, keepKekaPeople } from "./people";

function entry(email: string): KekaDirectoryEntry {
  return {
    kekaEmployeeId: email,
    email,
    displayName: email.split("@")[0],
    jobTitle: null,
    department: null,
    managerKekaId: null,
    managerName: null,
    managerEmail: null,
    userId: null,
    joiningDate: null,
  };
}

// Alice and Bob are current employees; nobody else is.
const dir = new KekaDirectory([entry("alice@x.com"), entry("bob@x.com")], []);

type Row = { who: string | null; n: number };

test("keepKekaPeople keeps current employees and drops everyone else", () => {
  const rows: Row[] = [
    { who: "alice@x.com", n: 1 },
    { who: "exited@x.com", n: 2 },
    { who: "bob@x.com", n: 3 },
    { who: "client@customer.com", n: 4 },
  ];
  const kept = keepKekaPeople(rows, (r) => r.who, dir).map((r) => r.who);
  assert.deepEqual(kept, ["alice@x.com", "bob@x.com"]);
});

test("keepKekaPeople matches case-insensitively — Jira stores mixed-case emails", () => {
  const rows: Row[] = [{ who: "ALICE@X.com", n: 1 }];
  assert.equal(keepKekaPeople(rows, (r) => r.who, dir).length, 1);
});

test("a missing or blank email is a miss, not a free pass", () => {
  const rows: Row[] = [
    { who: null, n: 1 },
    { who: "", n: 2 },
  ];
  assert.deepEqual(keepKekaPeople(rows, (r) => r.who, dir), []);
});

test("keepKekaPeople preserves the caller's ordering", () => {
  const rows: Row[] = [
    { who: "bob@x.com", n: 9 },
    { who: "gone@x.com", n: 8 },
    { who: "alice@x.com", n: 7 },
  ];
  assert.deepEqual(
    keepKekaPeople(rows, (r) => r.who, dir).map((r) => r.n),
    [9, 7]
  );
});

function render(frag: ReturnType<typeof isKekaPerson>): string {
  return new PgDialect().sqlToQuery(frag).sql;
}

test("isKekaPerson is a subquery membership test, so it can't fan out rows", () => {
  // A JOIN would duplicate the outer row when two Keka rows share an email
  // (a rehire); a subquery cannot. Guards that property at the SQL-text level.
  const text = render(isKekaPerson(sql`lower(ji.assignee_email)`));
  assert.match(text, /keka_employees/);
  assert.match(text, /lower\(ji\.assignee_email\)/);
  // Only rows with a work email can match — a null-email Keka row is not a person.
  assert.match(text, /email IS NOT NULL/);
});

test("the caller's expression sits OUTSIDE the subquery — no column capture", () => {
  // Regression test for a live bug. keka_employees has columns `email` and
  // `manager_email`, so with the old `EXISTS (… WHERE ke.email = <expr>)`
  // shape an unqualified outer reference was captured by the INNER table:
  // `ke.email = lower(email)` became `ke.email = lower(ke.email)`, true for
  // every row, and the gate silently admitted everyone. It let 19 departed bug
  // owners through and is invisible to tsc, the build, and any test that
  // doesn't run against Postgres.
  //
  // The invariant that prevents it: the caller's expression must appear before
  // the subquery's SELECT, where the OUTER query's scope applies.
  for (const bare of ["email", "lower(email)", "lower(manager_email)"]) {
    const text = render(isKekaPerson(sql.raw(bare)));
    const exprAt = text.indexOf(bare);
    const selectAt = text.toLowerCase().indexOf("select");
    assert.ok(exprAt >= 0, `expression "${bare}" missing from rendered SQL`);
    assert.ok(
      exprAt < selectAt,
      `"${bare}" must precede the subquery SELECT or the inner table captures ` +
        `it; rendered as: ${text.replace(/\s+/g, " ")}`
    );
  }
});
