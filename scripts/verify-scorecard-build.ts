// Smoke-tests the scorecard build pipeline end-to-end against the real DB.
// NOTE: complexity / issue-owner / original-estimate are empty until a full
// Jira resync, so AI-tasks and Complex-tasks scores will be muted pre-resync.
// Run: pnpm tsx --env-file=.env.local scripts/verify-scorecard-build.ts

import { buildScorecards } from "../src/lib/scorecard/build";
import { currentQuarter } from "../src/lib/scorecard/quarter";
import { db } from "../src/lib/db";
import { performanceScorecards } from "../src/lib/db/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  const q = currentQuarter();
  console.log(`Building scorecards for ${q.label} (${q.start} → ${q.end})…`);
  const res = await buildScorecards(q.key);
  console.log(`✓ scored ${res.developersScored} developer(s)`);

  const top = await db
    .select()
    .from(performanceScorecards)
    .where(eq(performanceScorecards.quarterKey, q.key))
    .orderBy(desc(performanceScorecards.finalScore))
    .limit(5);

  console.log("\nTop 5 by final score:");
  for (const r of top) {
    console.log(
      `  ${r.finalScore.toFixed(3)}  ${r.userEmail}  ` +
        `[bugQ=${r.bugQualityPoints?.toFixed(2)} sprint=${r.sprintCommitmentPoints?.toFixed(
          2
        )} complex=${r.complexTasksPoints?.toFixed(2)} mttr=${r.mttrPoints?.toFixed(
          2
        )} ai=${r.underestimatedTasksPoints?.toFixed(2)} | features=${r.featureCount} bugs=${r.weightedBugs} tasks=${r.complexTasksCount}]`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
