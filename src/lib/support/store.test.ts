// Renders SQL only; no query is ever executed (importing @/lib/db creates an
// idle pool but never connects).
import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { jiraIssues } from "@/lib/db/schema";
import { liveEventsJsonSql } from "./store";

test("live events subquery names the real table with an alias", () => {
  const { sql: text } = new PgDialect().sqlToQuery(liveEventsJsonSql(jiraIssues.id));
  assert.match(text, /from "support_ticket_ownership_events" as "ev"/);
  assert.doesNotMatch(text, /from "ev"/);
  assert.match(text, /"ev"\."side"/);
  assert.match(text, /order by "ev"\."at"/);
  assert.match(text, /"ev"\."issue_id" = "jira_issues"\."id"/);
  assert.match(text, /"ev"\."deleted_at" is null/);
});
