/**
 * One-off script: patch date custom fields for all projects.
 * Fetches duedate + 4 date customfields from Jira and merges them into
 * each issue's custom_fields JSONB column without touching other data.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/resync-date-fields.ts
 */

import { createDecipheriv } from "crypto";
import { Pool } from "pg";

const DATE_FIELDS = [
  "duedate",
  "customfield_10015",
  "customfield_10014",
  "customfield_10021",
  "customfield_11449",
];

function decrypt(value: string): string {
  const PREFIX = "enc:v1:";
  if (!value.startsWith(PREFIX)) return value;
  const [ivHex, tagHex, ciphertextHex] = value.slice(PREFIX.length).split(":");
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

async function jiraGet(baseUrl: string, email: string, token: string, path: string) {
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ issues?: { id: string; fields: Record<string, unknown> }[]; nextPageToken?: string }>;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  });

  const { rows: projects } = await pool.query<{
    id: string; name: string; jira_base_url: string;
    jira_project_key: string; jira_email: string; jira_api_token: string;
  }>(`SELECT id, name, jira_base_url, jira_project_key, jira_email, jira_api_token
      FROM jira_projects ORDER BY name`);

  console.log(`Found ${projects.length} projects\n`);

  const fields = DATE_FIELDS.join(",");

  for (const project of projects) {
    let token: string;
    try { token = decrypt(project.jira_api_token); }
    catch { console.log(`  Skipping ${project.name} — cannot decrypt token`); continue; }

    let synced = 0, errors = 0;
    let nextPageToken: string | undefined;

    console.log(`→ ${project.name} (${project.jira_project_key})`);

    for (;;) {
      const jql = encodeURIComponent(`project = "${project.jira_project_key}" ORDER BY created ASC`);
      let url = `/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100`;
      if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

      let data: Awaited<ReturnType<typeof jiraGet>>;
      try { data = await jiraGet(project.jira_base_url, project.jira_email, token, url); }
      catch (e) { console.error(`  Fetch error: ${e}`); break; }

      const issues = data.issues ?? [];
      if (issues.length === 0) break;

      for (const issue of issues) {
        const patch: Record<string, unknown> = {};
        for (const f of DATE_FIELDS) {
          if (issue.fields[f] != null) patch[f] = issue.fields[f];
        }
        if (Object.keys(patch).length === 0) continue;

        try {
          await pool.query(
            `UPDATE jira_issues
             SET custom_fields = custom_fields || $1::jsonb
             WHERE project_id = $2 AND jira_id = $3`,
            [JSON.stringify(patch), project.id, issue.id]
          );
          synced++;
        } catch (e) {
          console.error(`  Update error for ${issue.id}: ${e}`);
          errors++;
        }
      }

      nextPageToken = data.nextPageToken;
      if (!nextPageToken) break;
    }

    console.log(`  ✓ ${synced} updated, ${errors} errors\n`);
  }

  await pool.end();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
