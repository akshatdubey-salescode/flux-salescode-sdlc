// The one gate for "may this person appear in Flux at all".
//
// Flux's people universe is the synced Keka directory and nothing else.
// keka_employees only ever holds currently-employed staff — the directory sync
// hard-prunes relieved rows (see sync.ts) — so "has a keka_employees row with
// an email" is exactly "is a current colleague". Every other people-bearing
// table carries extra identities that must never surface as a person in the
// product: ex-employees whose Jira issues outlive them, client/customer
// reporters, vendor and Atlassian service accounts, GitHub logins mapped to
// nobody, and board members added before this rule existed.
//
// Scope of the rule (decided deliberately — don't widen without asking):
//   • ASSIGNEES, OWNERS and TEAM MEMBERS are gated. Anywhere a person is
//     picked, ranked, grouped, or listed as doing work.
//   • REPORTERS and CREATORS are NOT gated. Clients raise bugs and must stay
//     visible and attributable on the issues they filed.
//   • SUPERUSER / ADMIN tooling is NOT gated. Admin → Users, the Jira
//     inactive-user scan and Provision Teams exist precisely to find and clean
//     up non-Keka accounts; filtering them would hide the rows to act on.
//
// Any `"use cache"` reader that applies one of these helpers must also
// cacheTag(KEKA_DIRECTORY_TAG), so a Keka sync refreshes what the gate admits.

import { sql, type SQL } from "drizzle-orm";
import type { KekaDirectory } from "./directory";

/**
 * SQL predicate: true when `emailExpr` resolves to a current Keka employee.
 * Pass an already-lowercased expression (`sql\`lower(ji.assignee_email)\``) —
 * keka_employees.email is stored lowercased by the sync, so no lower() is
 * applied on the directory side.
 *
 * Prefer this over a JOIN when the surrounding query already groups or
 * distincts on the email: it can't duplicate rows.
 *
 * `<expr> IN (subquery)` rather than `EXISTS (… WHERE ke.email = <expr>)`, and
 * the difference is load-bearing. keka_employees has columns named `email` and
 * `manager_email`, so inside an EXISTS subquery an UNQUALIFIED outer reference
 * gets captured by the inner table: `ke.email = lower(email)` silently becomes
 * `ke.email = lower(ke.email)`, which is true for every row, and the whole
 * predicate degrades to "keka_employees is non-empty" — a gate that admits
 * everyone, with no error to notice. Postgres resolves the outer operand of
 * IN in the OUTER query's scope, so a bare `email` binds where the caller
 * meant it to and capture is structurally impossible.
 *
 * This was a live bug, not a hypothetical: it let 19 departed bug owners
 * through the People × Projects gate and it is invisible to typechecking, the
 * build, and any test that doesn't hit a real Postgres. Don't refactor this
 * back to EXISTS.
 */
export function isKekaPerson(emailExpr: SQL): SQL {
  return sql`${emailExpr} IN (
    SELECT keka_gate.email FROM keka_employees keka_gate
    WHERE keka_gate.email IS NOT NULL
  )`;
}

/**
 * Drop every row whose email isn't a current Keka employee. The in-memory
 * counterpart to `isKekaPerson`, for lists already materialised in JS (a
 * leaderboard assembled from several queries, a scorecard table, …).
 *
 * A missing/blank email is a miss: an unidentifiable person can't be shown to
 * be a colleague, so it doesn't get the benefit of the doubt.
 */
export function keepKekaPeople<T>(
  rows: T[],
  emailOf: (row: T) => string | null | undefined,
  dir: KekaDirectory
): T[] {
  return rows.filter((row) => dir.isActive(emailOf(row)));
}
