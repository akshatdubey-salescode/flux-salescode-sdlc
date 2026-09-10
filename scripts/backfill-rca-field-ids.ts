/**
 * One-off script: populate jira_projects.rca_field_ids for projects that have
 * never been full-synced since the RCA indicator shipped.
 *
 * The Bug Board's "RCA missing" indicator reads jira_issues.custom_fields
 * through the per-project jira_projects.rca_field_ids list (see
 * src/lib/jira/rca.ts). That column is only ever written by
 * discoverProjectFields() inside a full syncProject() run — webhook upserts
 * store the RCA value into custom_fields but never refresh the column. So a
 * project last full-synced before the feature landed has rca_field_ids = NULL
 * and every one of its bugs reads as "RCA missing" even when the Jira field is
 * filled in.
 *
 * /rest/api/3/field is site-wide, so the discovered ids are identical for
 * every project sharing a Jira base URL — fetched once per site, not per
 * project. The name match is the same one sync.ts uses (`\brca\b`,
 * case-insensitive, custom fields only), so a later real sync writes the same
 * value this backfill does.
 *
 * Dry run:  ./node_modules/.bin/tsx --env-file=.env.local scripts/backfill-rca-field-ids.ts
 * Apply:    ./node_modules/.bin/tsx --env-file=.env.local scripts/backfill-rca-field-ids.ts --apply
 *
 * Add --all to also overwrite projects that already have a non-empty list.
 */

import { createDecipheriv } from "crypto";
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

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

type FieldDef = { id: string; name: string; custom: boolean };

async function fetchRcaFieldIds(baseUrl: string, email: string, token: string) {
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/api/3/field`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
  const fields = (await res.json()) as FieldDef[];
  return fields
    .filter((f) => f.custom && /\brca\b/i.test(f.name))
    .map((f) => ({ id: f.id, name: f.name }));
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
  });

  const { rows: projects } = await pool.query<{
    id: string;
    name: string;
    jira_project_key: string;
    jira_base_url: string;
    jira_email: string;
    jira_api_token: string;
    rca_field_ids: string[] | null;
  }>(`SELECT id, name, jira_project_key, jira_base_url, jira_email,
             jira_api_token, rca_field_ids
      FROM jira_projects
      ORDER BY jira_project_key`);

  const targets = projects.filter((p) => ALL || !p.rca_field_ids?.length);
  console.log(
    `${projects.length} projects, ${targets.length} need rca_field_ids ` +
      `(${APPLY ? "APPLY" : "dry run — pass --apply to write"})\n`
  );
  if (!targets.length) return void pool.end();

  // One /field call per distinct site credential, reused across its projects.
  const cache = new Map<string, { id: string; name: string }[]>();
  let updated = 0;
  let failed = 0;

  for (const p of targets) {
    const cacheKey = `${p.jira_base_url}|${p.jira_email}`;
    let discovered = cache.get(cacheKey);
    if (!discovered) {
      try {
        discovered = await fetchRcaFieldIds(
          p.jira_base_url,
          p.jira_email,
          decrypt(p.jira_api_token)
        );
        cache.set(cacheKey, discovered);
        console.log(
          `[${p.jira_base_url}] discovered ${discovered.length} RCA field(s): ` +
            discovered.map((f) => `${f.name} (${f.id})`).join(", ")
        );
      } catch (err) {
        failed++;
        console.error(`  ${p.jira_project_key}: field fetch failed — ${err}`);
        continue;
      }
    }

    const ids = discovered.map((f) => f.id);
    if (!ids.length) {
      console.log(`  ${p.jira_project_key}: no RCA field on this site — skipped`);
      continue;
    }

    if (APPLY) {
      await pool.query(`UPDATE jira_projects SET rca_field_ids = $1 WHERE id = $2`, [
        ids,
        p.id,
      ]);
    }
    updated++;
    console.log(`  ${p.jira_project_key}: ${APPLY ? "set" : "would set"} ${ids.length} id(s)`);
  }

  console.log(
    `\n${APPLY ? "Updated" : "Would update"} ${updated} project(s)` +
      (failed ? `, ${failed} failed` : "")
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
