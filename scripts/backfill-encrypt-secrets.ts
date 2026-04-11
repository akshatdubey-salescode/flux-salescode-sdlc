/**
 * One-time backfill: encrypt plaintext jira_api_token and webhook_secret
 * in all existing jira_projects rows.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/backfill-encrypt-secrets.ts
 *
 * (tsx is not a project dep — install it once globally: npm i -g tsx)
 *
 * Safe to run multiple times — already-encrypted rows are skipped.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { jiraProjects } from "../src/lib/db/schema";
import { encrypt, isEncrypted } from "../src/lib/crypto";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db
    .select({
      id: jiraProjects.id,
      jiraApiToken: jiraProjects.jiraApiToken,
      webhookSecret: jiraProjects.webhookSecret,
    })
    .from(jiraProjects);

  console.log(`Found ${rows.length} project(s) to check.`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const tokenNeedsEncrypt = !isEncrypted(row.jiraApiToken);
    const secretNeedsEncrypt = !isEncrypted(row.webhookSecret);

    if (!tokenNeedsEncrypt && !secretNeedsEncrypt) {
      skipped++;
      continue;
    }

    await db
      .update(jiraProjects)
      .set({
        ...(tokenNeedsEncrypt && { jiraApiToken: encrypt(row.jiraApiToken) }),
        ...(secretNeedsEncrypt && { webhookSecret: encrypt(row.webhookSecret) }),
      })
      .where(eq(jiraProjects.id, row.id));

    console.log(`  ✓ Encrypted row ${row.id}`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Already encrypted (skipped): ${skipped}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
