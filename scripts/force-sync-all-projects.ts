/**
 * Force-syncs all Jira projects on the prod instance, one at a time.
 * Enqueues each sync via the prod API and polls until complete before moving on.
 *
 * Prerequisites:
 *   1. Grab your Clerk session token from the browser:
 *      DevTools → Application → Cookies → __session
 *   2. Set it in .env.local:
 *      SYNC_SESSION_TOKEN=<value>
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/force-sync-all-projects.ts
 */

import "dotenv/config";

const BASE_URL = "https://salescode-sdlc-v2.vercel.app";
const POLL_INTERVAL_MS = 3000;

const token = process.env.SYNC_SESSION_TOKEN;
if (!token) {
  console.error("Missing SYNC_SESSION_TOKEN in .env.local");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Cookie: `__session=${token}; __session_Exyj7fvj=${token}`,
};

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    redirect: "manual",
    headers: { ...headers, ...options.headers },
  });
  if (res.status === 307 || res.status === 302) {
    throw new Error(`Auth redirect — session token expired or invalid`);
  }
  return res;
}

async function fetchProjects(): Promise<{ id: string; name: string; jiraProjectKey: string }[]> {
  const res = await apiFetch("/api/projects");
  if (!res.ok) throw new Error(`GET /api/projects failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function enqueueSync(projectId: string): Promise<{ jobId: string; status: string }> {
  const res = await apiFetch(`/api/projects/${projectId}/sync`, { method: "POST" });
  if (res.status === 429) throw new Error("Rate limited — too many concurrent syncs");
  if (!res.ok) throw new Error(`POST /sync failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pollUntilDone(jobId: string, label: string): Promise<void> {
  for (;;) {
    const res = await apiFetch(`/api/sync-jobs/${jobId}`);
    if (!res.ok) throw new Error(`GET /sync-jobs/${jobId} failed: ${res.status}`);

    const job = await res.json() as {
      status: string;
      syncedCount: number;
      totalIssues: number | null;
      errorCount: number;
    };

    const progress = job.totalIssues
      ? `${job.syncedCount}/${job.totalIssues}`
      : `${job.syncedCount} synced`;

    process.stdout.write(`\r  ${label} — ${progress}, errors: ${job.errorCount}   `);

    if (job.status === "completed") {
      process.stdout.write("\n");
      return;
    }

    if (job.status === "failed") {
      process.stdout.write("\n");
      throw new Error(`Job ${jobId} failed`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main() {
  const projects = await fetchProjects();
  console.log(`Found ${projects.length} projects\n`);

  let succeeded = 0;
  let failed = 0;

  for (const [i, project] of projects.entries()) {
    const label = `[${i + 1}/${projects.length}] ${project.name} (${project.jiraProjectKey})`;
    console.log(`→ ${label}`);

    try {
      const { jobId, status } = await enqueueSync(project.id);
      if (status === "existing") {
        console.log(`  ℹ Already running (job ${jobId}), polling...`);
      }
      await pollUntilDone(jobId, "syncing");
      console.log(`  ✓ Done\n`);
      succeeded++;
    } catch (err) {
      console.error(`  ✗ ${err}\n`);
      failed++;
    }
  }

  console.log(`Finished: ${succeeded} succeeded, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
