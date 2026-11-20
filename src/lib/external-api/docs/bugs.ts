// Markdown docs for the bug board API (/api/v1/projects, /api/v1/bugs,
// /api/v1/projects/{id}/bugs), shown (and downloadable) in the superuser API
// Tokens page. Kept as a TS string rather than a .md file so it is always
// bundled (no runtime fs read). {{BASE_URL}} is replaced with the deployment's
// origin when shown. Keep in sync with bugs-params.ts.
export const BUGS_DOC = `# Bug board API

Returns bugs (the same rows the **Bug Summary** tab shows) for one project or many, with every filter that tab has.

\`\`\`text
GET {{BASE_URL}}/api/v1/projects                      list the projects you can read
GET {{BASE_URL}}/api/v1/bugs?projects=SC,DEV          bugs across projects, by Jira key
GET {{BASE_URL}}/api/v1/projects/{projectId}/bugs     bugs of one project, by id
\`\`\`

## Authentication

Send the token as a bearer token. The token has no expiry and works until a superuser revokes it.

\`\`\`text
Authorization: Bearer flx_…
\`\`\`

Call this API **server-to-server only**. Never put the token in browser or mobile app code: anyone who can see it can use it.

The token needs the \`bugs:read\` scope. If it is limited to certain projects, it can only see those projects.

## List projects

\`\`\`text
GET {{BASE_URL}}/api/v1/projects
\`\`\`

Returns every project the token can read. Use it to map a project's name or Jira key to its \`id\`.

\`\`\`json
{
  "projects": [
    { "id": "09f52ba2-…", "key": "SC", "name": "Salescode", "jiraBaseUrl": "https://example.atlassian.net", "isActive": true }
  ]
}
\`\`\`

Inactive projects are archived in Flux. They are listed, but not included in \`/api/v1/bugs\` unless you name them in \`projects\`.

## Bugs across projects

\`\`\`text
GET {{BASE_URL}}/api/v1/bugs?projects=SC,DEV
\`\`\`

\`projects\` is optional. It takes a comma-separated list of Jira project keys (case-insensitive) and/or project ids, and may mix the two.

- **Omitted:** every active project the token can read.
- **A key that two Jira sites both use:** you get a \`400\`. Use that project's \`id\` instead.
- **An unknown project, or one the token can't read:** you get a \`400\` naming it.

The response lists the projects it covered:

\`\`\`json
{
  "projects": [{ "id": "09f52ba2-…", "key": "SC", "name": "Salescode" }],
  "total": 132,
  "count": 100,
  "limit": 100,
  "offset": 0,
  "filters": { "start": "2000-01-01", "end": "2026-11-20", "status": "open", "...": "..." },
  "bugs": [ … ]
}
\`\`\`

Use \`projectKey\` on each bug to tell projects apart, and \`sort=project\` to group them.

## Bugs of one project

\`\`\`text
GET {{BASE_URL}}/api/v1/projects/{projectId}/bugs
\`\`\`

\`projectId\` is the Flux project id (a UUID) from \`GET /api/v1/projects\`, or from the project's URL in Flux: \`/projects/{projectId}\`. The response has a single \`project\` object in place of \`projects\`. Otherwise it is the same as above.

## Query parameters

These work on both bug routes. All are optional.

| Name | Format | Default | Description |
|---|---|---|---|
| \`projects\` | comma list of keys/ids | all active | **\`/api/v1/bugs\` only.** Projects to include |
| \`start\` | \`YYYY-MM-DD\` | \`2000-01-01\` | Bugs **created** on or after this date |
| \`end\` | \`YYYY-MM-DD\` | today | Bugs **created** on or before this date |
| \`env\` | text | any | Exact environment label, e.g. \`Production\`, \`UAT\`. Bugs with no environment use \`—\` |
| \`owner\` | email or name | any | Bugs this person owns **or** is assigned to. Use the email where the person has one |
| \`q\` | text | none | Case-insensitive search in key, summary, owner, assignee, environment, priority, status and project |
| \`includeInvalid\` | \`true\` / \`false\` | \`false\` | Include bugs closed as "Not a bug" or "Can't Reproduce" |
| \`status\` | \`all\` / \`open\` / \`closed\` | \`all\` | Open = not yet resolved |
| \`priority\` | comma list of \`P1,P2,P3,Other\` | any | Priority buckets to keep |
| \`sort\` | see below | \`priority\` | Sort column |
| \`dir\` | \`asc\` / \`desc\` | \`asc\` | Sort direction |
| \`limit\` | 1 to 5000 | \`1000\` | Page size |
| \`offset\` | integer ≥ 0 | \`0\` | Rows to skip, for paging |

\`sort\` is one of: \`key\`, \`project\`, \`summary\`, \`owner\`, \`assignee\`, \`priority\`, \`environment\`, \`status\`, \`start\` (created), \`end\` (closed; open bugs always last), \`updated\`. Ties are broken by Jira key.

An invalid value gets a \`400\` with a message saying which parameter is wrong.

## Bug fields

\`\`\`json
{
  "id": "…",
  "jiraKey": "SC-1234",
  "summary": "Order sync fails for large carts",
  "projectKey": "SC",
  "projectName": "Salescode",
  "jiraBaseUrl": "https://example.atlassian.net",
  "status": "In Progress",
  "statusCategory": "indeterminate",
  "priority": "P1",
  "priorityBucket": "P1",
  "environment": "Production",
  "rcaGiven": false,
  "rcaText": null,
  "ownerName": "Jane Doe",
  "ownerEmail": "jane@salescode.ai",
  "assigneeName": "John Roe",
  "assigneeEmail": "john@salescode.ai",
  "isOpen": true,
  "isInvalid": false,
  "jiraCreatedAt": "2026-10-01T09:12:00.000Z",
  "jiraUpdatedAt": "2026-10-03T14:40:00.000Z",
  "jiraClosedAt": null
}
\`\`\`

- \`total\` is the number of bugs matching the filters before paging. Fetch the next page with \`offset = offset + limit\` while \`offset + count < total\`.
- \`ownerName\` is \`Missing Issue Owner\` when the Jira "Issue Owner" field is empty. The owner is never taken from the assignee.
- \`jiraClosedAt\` is \`null\` while the bug is open.
- Data is cached for a few minutes, so a change in Jira can take a short while to show.

## Errors

All errors are JSON: \`{ "error": "<code>", "message": "<reason>" }\`.

| Status | \`error\` | When |
|---|---|---|
| 400 | \`bad_request\` | A query parameter, project key or project id is invalid |
| 401 | \`unauthorized\` | No token, a malformed header, or an invalid or revoked token |
| 403 | \`forbidden\` | The token lacks the \`bugs:read\` scope, or (per-project route) is not allowed that project |
| 404 | \`not_found\` | (Per-project route) no project with this id |
| 500 | \`internal_error\` | Something went wrong on our side |

## Examples

Which projects can I read?

\`\`\`bash
curl -H "Authorization: Bearer $FLUX_TOKEN" "{{BASE_URL}}/api/v1/projects"
\`\`\`

Open P1 and P2 production bugs in SC and DEV, most recently updated first:

\`\`\`bash
curl -H "Authorization: Bearer $FLUX_TOKEN" \\
  "{{BASE_URL}}/api/v1/bugs?projects=SC,DEV&status=open&priority=P1,P2&env=Production&sort=updated&dir=desc"
\`\`\`

Every bug created in 2026 across all your projects, 500 at a time:

\`\`\`bash
curl -H "Authorization: Bearer $FLUX_TOKEN" \\
  "{{BASE_URL}}/api/v1/bugs?start=2026-01-01&end=2026-12-31&limit=500&offset=0"
\`\`\`

One project by id:

\`\`\`bash
curl -H "Authorization: Bearer $FLUX_TOKEN" \\
  "{{BASE_URL}}/api/v1/projects/{projectId}/bugs?status=open"
\`\`\`
`;
