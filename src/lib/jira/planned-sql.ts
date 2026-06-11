import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { DEFAULT_START_DATE_KEYS, DEFAULT_DUE_DATE_KEYS } from "./dates";

// SQL counterparts to extractStartDate / extractDueDate in ./dates.ts. Both
// derive from the same key arrays, so a row classified "planned" in SQL (for
// filtering / sorting) matches what extractStartDate/extractDueDate report for
// display. Mirrors HAS_START_EXPR / HAS_DUE_EXPR in the top-unplanned-assignees
// view, but parameterized by column refs so it works inside a joined query.

function hasDateSql(
  customFields: AnyColumn,
  fieldIds: AnyColumn,
  keys: readonly string[]
): SQL {
  const keyChecks = keys.map((k) => sql`NULLIF(${customFields}->>${k}, '')`);
  return sql`(
    COALESCE(${sql.join(keyChecks, sql`, `)}) IS NOT NULL
    OR (
      ${fieldIds} IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(${fieldIds}) AS fid
        WHERE NULLIF(${customFields}->>fid, '') IS NOT NULL
      )
    )
  )`;
}

/** True when the issue has a start date in any known field. */
export function hasStartDateSql(customFields: AnyColumn, fieldIds: AnyColumn): SQL {
  return hasDateSql(customFields, fieldIds, DEFAULT_START_DATE_KEYS);
}

/** True when the issue has a due/end date in any known field. */
export function hasDueDateSql(customFields: AnyColumn, fieldIds: AnyColumn): SQL {
  return hasDateSql(customFields, fieldIds, DEFAULT_DUE_DATE_KEYS);
}
