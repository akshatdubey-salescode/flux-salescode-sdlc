// Markdown docs for GET /api/v1/sla-violations, appended to the bug board docs
// (same `bugs:read` scope). {{BASE_URL}} is replaced with the deployment's
// origin when shown. Keep in sync with sla-params.ts.
export const SLA_VIOLATIONS_DOC = `
# SLA breaches API

Returns SLA rule violations: Jira issues that stayed in a project's SLA-rule condition longer than the rule's threshold. These are the rows the **SLA** violations list in Flux shows.

\`\`\`text
GET {{BASE_URL}}/api/v1/sla-violations?projects=SC,DEV
\`\`\`

The token needs the \`bugs:read\` scope. If it is limited to certain projects, it can only see those projects.

## Query parameters

All are optional.

| Name | Format | Default | Description |
|---|---|---|---|
| \`projects\` | comma list of keys/ids | all active | Projects to include. Same rules as \`/api/v1/bugs\`: Jira keys (case-insensitive) and/or project ids |
| \`status\` | \`open\` / \`resolved\` / \`all\` | \`open\` | Open = not yet resolved. Resolved = dismissed by an admin in Flux |
| \`limit\` | 1 to 1000 | \`200\` | Page size |
| \`offset\` | integer ≥ 0 | \`0\` | Rows to skip, for paging |

Rows are sorted by \`violatedAt\`, newest first. An invalid value gets a \`400\` with a message saying which parameter is wrong.

## Response

\`\`\`json
{
  "projects": [{ "id": "09f52ba2-…", "key": "SC", "name": "Salescode" }],
  "total": 12,
  "count": 12,
  "limit": 200,
  "offset": 0,
  "filters": { "status": "open", "limit": 200, "offset": 0 },
  "violations": [
    {
      "id": "…",
      "ruleId": "…",
      "ruleName": "P1 in Dev > 24h",
      "projectKey": "SC",
      "projectName": "Salescode",
      "jiraBaseUrl": "https://example.atlassian.net",
      "jiraKey": "SC-1234",
      "summary": "Order sync fails for large carts",
      "status": "In Progress",
      "priority": "P1",
      "assigneeName": "John Roe",
      "assigneeEmail": "john@salescode.ai",
      "enteredConditionAt": "2026-11-20T09:00:00.000Z",
      "violatedAt": "2026-11-21T09:00:00.000Z",
      "thresholdHours": 24,
      "actualHours": 26.5,
      "escalatedAt": null,
      "resolvedAt": null,
      "resolvedReason": null
    }
  ]
}
\`\`\`

- \`thresholdHours\` is the rule's threshold when the breach was recorded; the rule may have changed since.
- \`actualHours\` is the time the issue had spent in the condition when the breach was recorded.
- \`escalatedAt\` is set once the escalation email went out (threshold × the rule's escalation multiplier).
- A violation is not resolved automatically when the issue leaves the condition; it stays open until an admin dismisses it. \`resolvedReason\` is then \`manual_dismiss\`. Check \`status\` for the issue's current Jira status.
- Fetch the next page with \`offset = offset + limit\` while \`offset + count < total\`.

## SLA rules

\`\`\`text
GET {{BASE_URL}}/api/v1/sla-rules?projects=SC,DEV
\`\`\`

Lists the SLA rules defined for each project, so you can see what a violation's \`ruleId\` / \`ruleName\` means. \`projects\` works as above. Inactive rules are listed too, with \`isActive: false\`; only active rules create violations.

\`\`\`json
{
  "projects": [{ "id": "09f52ba2-…", "key": "SC", "name": "Salescode" }],
  "count": 1,
  "rules": [
    {
      "id": "…",
      "projectKey": "SC",
      "projectName": "Salescode",
      "name": "P1 in Dev > 24h",
      "description": null,
      "isActive": true,
      "conditionText": "Priority is P1 AND Status is any of In Progress, In Dev",
      "conditions": {
        "operator": "OR",
        "groups": [
          {
            "operator": "AND",
            "conditions": [
              { "field": "priority", "operator": "equals", "value": "P1" },
              { "field": "status", "operator": "in", "value": "In Progress,In Dev" }
            ]
          }
        ]
      },
      "thresholdHours": 24,
      "escalationMultiplier": 2,
      "escalationHours": 48,
      "notifyAssignee": true,
      "notifyReporter": false,
      "createdAt": "2026-10-01T09:00:00.000Z",
      "updatedAt": "2026-10-01T09:00:00.000Z"
    }
  ]
}
\`\`\`

How a rule is applied:

- \`conditions\` is an OR of AND-groups: an issue matches when **every** condition in **any one** group holds. \`conditionText\` is the same thing in words.
- \`field\` is one of \`status\`, \`status_category\`, \`issue_type\`, \`priority\` (compared to the issue's current Jira value, exact and case-sensitive) or \`created_at\` (a \`YYYY-MM-DD\` date, UTC).
- \`operator\` is \`equals\`, \`not_equals\` or \`in\` (comma-separated values) for text fields, and \`on_or_after\`, \`on_or_before\` or \`on_date\` for \`created_at\`.
- An issue breaches when it has matched for longer than \`thresholdHours\`. If the rule has a \`status\` or \`status_category\` condition, time is counted from when the issue entered its current status. Otherwise it is counted from when Flux last synced the issue.
- An escalation email goes out at \`escalationHours\` (\`thresholdHours × escalationMultiplier\`).
- Only active projects are checked.

## Example

Open SLA breaches in SC and DEV:

\`\`\`bash
curl -H "Authorization: Bearer $FLUX_TOKEN" \\
  "{{BASE_URL}}/api/v1/sla-violations?projects=SC,DEV"
\`\`\`
`;
