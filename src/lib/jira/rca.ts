// Extraction helper for the "RCA" (Root Cause Analysis) custom field that
// feeds the Bug Board's RCA given/not-given indicator. Like the
// performance-review fields in scorecard-fields.ts, this lives in
// jira_issues.custom_fields (JSONB), read at request time using the
// per-project field IDs discovered during sync (jira_projects.rca_field_ids).

type CustomFields = Record<string, unknown>;

export type RcaSummary = { given: boolean; text: string | null };

/**
 * Extract plain text from one custom-field value, whatever shape it turns
 * out to be: a plain string (a Jira "Text Field"), a Jira select-option
 * object ({ value: "..." }), or an Atlassian Document Format object (a
 * Jira "Paragraph" field — the same document shape as jiraIssues.description
 * and comment bodies).
 *
 * Unlike description/comments (deliberately JSON.stringify'd before storage
 * — see the jiraIssues.description column comment in schema.ts), a custom
 * field here lands in the custom_fields jsonb column already parsed, so an
 * ADF value is a plain JS object, not a JSON string — src/lib/jira/adf.ts's
 * adfToText() can't be reused directly (it JSON.parses its input first;
 * round-tripping an already-parsed value through JSON.stringify/adfToText
 * would silently break the plain-string case, since a stringified plain
 * string re-parses to a bare string, which adfToText's node-walk treats as
 * having no text). So this walks the value directly instead.
 */
function valueToText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    if ("value" in value && typeof (value as { value: unknown }).value === "string") {
      return ((value as { value: string }).value.trim()) || null;
    }
    const texts: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      const node = n as Record<string, unknown>;
      if (node.type === "text" && typeof node.text === "string") texts.push(node.text);
      if (Array.isArray(node.content)) for (const child of node.content) walk(child);
    };
    walk(value);
    return texts.join(" ").trim() || null;
  }
  return null;
}

/**
 * Read the RCA text from the first populated discovered field. Returns null
 * when no RCA field is set (or none was discovered for this project).
 */
export function extractRcaText(
  cf: CustomFields | null | undefined,
  discovered: string[] | null | undefined
): string | null {
  if (!cf || !discovered?.length) return null;
  for (const id of discovered) {
    const text = valueToText(cf[id]);
    if (text) return text;
  }
  return null;
}

/** `given` is true iff extractRcaText found non-empty content. */
export function rcaSummary(
  cf: CustomFields | null | undefined,
  discovered: string[] | null | undefined
): RcaSummary {
  const text = extractRcaText(cf, discovered);
  return { given: text !== null, text };
}

/**
 * Raw-SQL equivalent of `extractRcaText(...) !== null` (i.e. rcaSummary(...).given),
 * for routes that need to know RCA presence inside a SQL aggregate (e.g. the
 * Bug Board's per-cell "RCA Unavailable" COUNT(*) FILTER). `customFieldsCol`/
 * `fieldIdsCol` are already-qualified SQL column references (e.g.
 * "ji.custom_fields" / "jp.rca_field_ids") — interpolate the result with
 * sql.raw(...). Neither argument must ever be built from request/user input;
 * every call site passes a fixed source-code string.
 *
 * Same duplication tradeoff as priorityBucketSql (bug-summary.ts) — a
 * hand-maintained SQL mirror of the JS logic above, needed because SQL can't
 * call extractRcaText directly. Handles the two field shapes real "RCA"
 * fields on this site actually use (confirmed against live Jira data):
 * a plain non-empty string, or an Atlassian Document Format document with at
 * least one non-empty text node anywhere in its tree (jsonb_path_exists'
 * recursive `$.**` wildcard, rather than a hand-rolled walk). Does not
 * special-case the `{value: "..."}` select-option shape extractRcaText also
 * defends against — every real RCA field observed on this site is a
 * paragraph/textarea type, never a select, so it's not worth the extra SQL
 * complexity here.
 */
export function rcaGivenSql(customFieldsCol: string, fieldIdsCol: string): string {
  return `
    EXISTS (
      SELECT 1
      FROM unnest(COALESCE(${fieldIdsCol}, '{}'::text[])) AS fid
      WHERE ${customFieldsCol} ? fid
        AND (
          (jsonb_typeof(${customFieldsCol}->fid) = 'string' AND COALESCE(${customFieldsCol}->>fid, '') <> '')
          OR jsonb_path_exists(${customFieldsCol}->fid, '$.**.text ? (@ != "")')
        )
    )
  `;
}
