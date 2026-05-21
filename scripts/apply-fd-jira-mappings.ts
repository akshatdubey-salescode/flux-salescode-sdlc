/**
 * One-off script: apply Freshdesk ↔ Jira mappings extracted from the
 * CavinKare Ticket Summary Report Excel file.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/apply-fd-jira-mappings.ts
 */

import { Pool } from "pg";

const CAV_PROJECT_ID = "ced143dd-0fbd-4a46-9e96-38641aba6fa3";

// Extracted from April Tickets + May Tickets sheets (May Tickets used for FD#368 conflict)
const MAPPINGS: Array<[number, string]> = [
  [224, "CAV-2525"],
  [247, "CAV-2766"],
  [257, "CAV-2487"],
  [278, "CAV-2582"],
  [299, "CAV-2508"],
  [321, "CAV-2670"],
  [328, "CAV-2673"],
  [349, "CAV-2767"],
  [353, "CAV-2924"],
  [357, "CAV-2670"],
  [366, "CAV-2769"],
  [368, "CAV-2742"],
  [370, "CAV-2743"],
  [372, "CAV-2744"],
  [373, "CAV-2745"],
  [375, "CAV-2938"],
  [377, "CAV-2753"],
  [381, "CAV-2770"],
  [384, "CAV-2791"],
  [385, "CAV-2791"],
  [386, "CAV-2942"],
  [391, "CAV-2798"],
  [392, "CAV-2950"],
  [393, "CAV-2799"],
  [401, "CAV-2957"],
  [402, "CAV-2958"],
  [403, "CAV-2956"],
  [404, "CAV-2842"],
  [405, "CAV-2955"],
  [406, "CAV-2811"],
  [407, "CAV-2964"],
  [408, "CAV-2954"],
  [412, "CAV-2953"],
  [414, "CAV-2853"],
  [415, "CAV-2854"],
  [416, "CAV-2852"],
  [417, "CAV-2880"],
  [420, "CAV-2851"],
  [424, "CAV-2828"],
  [425, "CAV-2849"],
  [426, "CAV-2835"],
  [434, "CAV-2826"],
  [435, "CAV-2819"],
  [441, "CAV-2836"],
  [442, "CAV-2864"],
  [443, "CAV-2863"],
  [447, "CAV-2844"],
  [448, "CAV-2915"],
  [449, "CAV-2861"],
  [450, "CAV-2862"],
  [452, "CAV-2882"],
  [454, "CAV-2881"],
  [457, "CAV-2885"],
  [458, "CAV-2886"],
  [459, "CAV-2890"],
  [460, "CAV-2947"],
  [462, "CAV-2887"],
  [463, "CAV-2946"],
  [464, "CAV-2905"],
  [465, "CAV-2906"],
  [466, "CAV-2907"],
  [467, "CAV-2913"],
  [468, "CAV-2914"],
  [471, "CAV-2910"],
  [472, "CAV-2916"],
  [473, "CAV-2917"],
  [474, "CAV-2920"],
  [475, "CAV-2921"],
  [476, "CAV-2925"],
  [477, "CAV-2918"],
  [478, "CAV-2930"],
  [479, "CAV-2923"],
  [480, "CAV-2928"],
  [481, "CAV-2927"],
  [482, "CAV-2932"],
  [483, "CAV-2933"],
  [484, "CAV-2934"],
  [485, "CAV-2935"],
  [486, "CAV-2936"],
  [487, "CAV-2987"],
  [488, "CAV-2937"],
  [489, "CAV-2940"],
  [490, "CAV-2959"],
  [491, "CAV-2941"],
  [494, "CAV-2961"],
  [495, "CAV-2963"],
  [496, "CAV-2965"],
  [497, "CAV-2966"],
  [499, "CAV-2967"],
  [501, "CAV-2979"],
  [503, "CAV-2670"],
  [504, "CAV-2990"],
  [505, "CAV-2992"],
  [506, "CAV-2925"],
  [507, "CAV-2985"],
  [511, "CAV-2988"],
  [513, "CAV-2994"],
  [514, "CAV-2996"],
  [517, "CAV-2998"],
  [519, "CAV-2999"],
  [520, "CAV-3000"],
  [521, "CAV-3001"],
  [522, "CAV-3002"],
  [523, "CAV-3003"],
  [535, "CAV-3014"],
  [536, "CAV-3015"],
  [537, "CAV-3025"],
  [539, "CAV-3026"],
  [547, "CAV-3027"],
  [552, "CAV-3037"],
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  let linked = 0;
  let missingFd = 0;
  let missingJira = 0;

  for (const [fdId, jiraKey] of MAPPINGS) {
    // Look up the Jira issue
    const jiraRes = await pool.query(
      `SELECT id, jira_key, status, assignee_name
       FROM jira_issues
       WHERE project_id = $1 AND jira_key = $2
       LIMIT 1`,
      [CAV_PROJECT_ID, jiraKey]
    );

    if (jiraRes.rows.length === 0) {
      console.log(`  SKIP  FD#${fdId} -> ${jiraKey}: Jira issue not in DB`);
      missingJira++;
      continue;
    }

    const jira = jiraRes.rows[0];

    // Update the freshdeskTickets row
    const updateRes = await pool.query(
      `UPDATE freshdesk_tickets
       SET linked_jira_issue_id  = $1,
           linked_jira_key       = $2,
           linked_jira_status    = $3,
           linked_jira_assignee_name = $4,
           synced_at             = NOW()
       WHERE project_id = $5 AND fd_ticket_id = $6
       RETURNING id`,
      [jira.id, jira.jira_key, jira.status, jira.assignee_name, CAV_PROJECT_ID, fdId]
    );

    if (updateRes.rowCount === 0) {
      console.log(`  SKIP  FD#${fdId} -> ${jiraKey}: FD ticket not in DB yet`);
      missingFd++;
      continue;
    }

    console.log(`  OK    FD#${fdId} -> ${jiraKey} (status: ${jira.status})`);
    linked++;
  }

  console.log(`\nDone: ${linked} linked, ${missingFd} FD tickets missing, ${missingJira} Jira issues missing`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
