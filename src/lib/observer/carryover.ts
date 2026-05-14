import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Auto-insert today's declarations for any JIRA that was declared on a previous
 * day with an expectedCompletionDate >= today and isn't already declared today.
 * Safe to call on every read — uses ON CONFLICT DO NOTHING.
 */
export async function ensureCarryoverDeclarations(
  email: string,
  today: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO engineer_work_declarations
      (engineer_email, jira_issue_id, declared_date, expected_completion_date)
    SELECT
      ${email},
      latest.jira_issue_id,
      ${today}::date,
      latest.expected_completion_date
    FROM (
      SELECT DISTINCT ON (ewd.jira_issue_id)
        ewd.jira_issue_id,
        ewd.expected_completion_date
      FROM engineer_work_declarations ewd
      JOIN jira_issues ji ON ji.id = ewd.jira_issue_id
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ewd.engineer_email = ${email}
        AND ewd.declared_date < ${today}::date
        AND ewd.expected_completion_date >= ${today}::date
        AND (psm.canonical_status IS NULL OR psm.canonical_status NOT IN ('DONE', 'CANCELLED'))
        AND NOT EXISTS (
          SELECT 1 FROM engineer_work_declarations ex
          WHERE ex.engineer_email = ${email}
            AND ex.jira_issue_id = ewd.jira_issue_id
            AND ex.declared_date = ${today}::date
        )
      ORDER BY ewd.jira_issue_id, ewd.declared_date DESC
    ) latest
    ON CONFLICT DO NOTHING
  `);
}
