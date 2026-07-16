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

// Only a value whose first 10 chars are an ISO calendar date (YYYY-MM-DD) is a
// usable date — mirrors toIsoDate() in ./dates.ts, guarding against fields that
// collide with non-date values (e.g. an Epic Link holding an issue key) so the
// ::date cast below never sees a non-date string.
const ISO_DATE_RE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}";

// SQL value counterpart to extractStartDate / extractDueDate: returns the first
// field (default keys first, then project-discovered ids, in order) whose value
// looks like an ISO date, cast to `date`; NULL when none match. Same precedence
// as pickDate() in ./dates.ts, so the filtered value matches what the display
// path shows.
function dateValueSql(
  customFields: AnyColumn,
  fieldIds: AnyColumn,
  keys: readonly string[]
): SQL {
  const keyExprs = keys.map(
    (k) => sql`CASE WHEN NULLIF(${customFields}->>${k}, '') ~ ${ISO_DATE_RE}
      THEN LEFT(${customFields}->>${k}, 10)::date END`
  );
  const discoveredExpr = sql`(
    SELECT LEFT(${customFields}->>fid, 10)::date
    FROM unnest(COALESCE(${fieldIds}, ARRAY[]::text[])) WITH ORDINALITY AS t(fid, ord)
    WHERE NULLIF(${customFields}->>fid, '') ~ ${ISO_DATE_RE}
    ORDER BY ord
    LIMIT 1
  )`;
  return sql`COALESCE(${sql.join([...keyExprs, discoveredExpr], sql`, `)})`;
}

/** The issue's planned start date (as `date`), or NULL when none is set. */
export function startDateValueSql(customFields: AnyColumn, fieldIds: AnyColumn): SQL {
  return dateValueSql(customFields, fieldIds, DEFAULT_START_DATE_KEYS);
}

/** The issue's planned due/end date (as `date`), or NULL when none is set. */
export function dueDateValueSql(customFields: AnyColumn, fieldIds: AnyColumn): SQL {
  return dateValueSql(customFields, fieldIds, DEFAULT_DUE_DATE_KEYS);
}
