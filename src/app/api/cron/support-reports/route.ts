import { buildSupportReport } from "@/lib/support/build";
import { isSendEnabled, notifyApprovers } from "@/lib/support/send";
import { approverNoticeCandidate, isBuildDue, isScheduledDay } from "@/lib/support/notice";
import { listEnabledProjects, markApproversNotified } from "@/lib/support/store";
import { dateInZone, minutesOfDayInZone } from "@/lib/support/tz";

// The 17:00-local support-report run.
//
// Bearer CRON_SECRET guard, mirroring scheduled-processes. Registered in
// vercel.json every 30 minutes; each run builds only the projects whose own
// timezone (Settings → Timezone) reads 17:00–17:29 — so every client's report
// is built at 17:00 their time, for their calendar day (user decision,
// 2026-11-21). Other projects are counted as `notDue`.
// GET is handled as well as POST because Vercel Cron issues a GET (with this
// same Authorization header, injected from CRON_SECRET); POST is kept so an
// external scheduler can take the job over without a code change.
//
// For each enabled project: build today's report (the build itself lapses older
// unapproved reports) and send the approvers' "ready for approval" notice once
// per report. The notice is claimed with a conditional UPDATE on
// approvers_notified_at before sending, so a second call the same day never
// re-notifies, and a manual "Build now" earlier in the day (which never
// notifies) does not suppress it. A report already sending/sent/failed is left
// untouched (counted as `skipped`).
export const maxDuration = 300; // Vercel caps this to the plan's actual max if lower.

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sends and cron builds only happen where explicitly enabled (not previews/UAT).
  if (!isSendEnabled()) {
    return Response.json({ skipped: "disabled in this environment" });
  }

  // Links in a mail have no browser to be relative to, so the app URL must come
  // from config; the request origin is only a local fallback.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");

  try {
    const now = new Date();
    const stats = { built: 0, lapsed: 0, notified: 0, skipped: 0, notDue: 0, failed: 0, errors: [] as string[] };

    for (const { projectId, timeZone, frequency, weeklyDay } of await listEnabledProjects()) {
      const today = dateInZone(now, timeZone);
      // Due = 17:00–17:29 local on a scheduled day (every day, or the weekly day).
      if (!isBuildDue(minutesOfDayInZone(now, timeZone)) || !isScheduledDay(frequency, weeklyDay, today)) {
        stats.notDue++;
        continue;
      }
      try {
        const result = await buildSupportReport(projectId, today, null);
        stats.lapsed += result.lapsed;
        if ("blocked" in result) {
          stats.skipped++;
          continue;
        }
        stats.built++;
        // Claim first, then send: only the caller that wins the claim mails.
        const noticeId = approverNoticeCandidate(isSendEnabled(), result);
        if (noticeId && (await markApproversNotified(noticeId))) {
          stats.notified++;
          await notifyApprovers(projectId, today, noticeId, appUrl);
        }
      } catch (err) {
        stats.failed++;
        const message = err instanceof Error ? err.message : String(err);
        stats.errors.push(`${projectId}: ${message}`);
        console.error(`[cron/support-reports] ${projectId} failed:`, err);
      }
    }

    if (stats.failed > 0) {
      // Non-2xx so a cron monitor alerts, with the stats still in the body.
      return Response.json(stats, { status: 500 });
    }
    return Response.json(stats);
  } catch (err) {
    console.error("[cron/support-reports] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
