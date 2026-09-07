import { runDueSchedules } from "@/lib/scheduled-processes/dispatch";
import { istToday } from "@/lib/scheduled-processes/recurrence";

// The midnight run for every scheduled process in the app.
//
// Bearer CRON_SECRET guard, mirroring keka-sync / github-sync / sla-check.
// Registered in vercel.json at 18:30 UTC — 00:00 IST, the zone the schedule
// dates, the risk columns and the emails themselves are all judged in. GET is
// handled as well as POST because Vercel Cron issues a GET (with this same
// Authorization header, injected from CRON_SECRET); POST is kept so an
// external scheduler — the Jenkins setup behind loc-sync, say — can take the
// job over without a code change.
//
// Safe to call more than once a night, deliberately: a run is claimed per
// (schedule, IST day) before any mail goes out, so a duplicate trigger is
// turned away rather than mailing twice. That also makes a second call the
// way to finish a night whose first call hit its time budget — check
// `remaining` in the response.
export const maxDuration = 800; // Vercel caps this to the plan's actual max if lower.

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

  // Links in a scheduled mail have no browser to be relative to, so the app
  // URL must come from config; the request origin is only a local fallback.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");

  try {
    const stats = await runDueSchedules({ appUrl, today: istToday() });
    if (stats.failed > 0) {
      // Non-2xx so a cron monitor alerts, with the stats still in the body.
      return Response.json(stats, { status: 500 });
    }
    return Response.json(stats);
  } catch (err) {
    console.error("[cron/scheduled-processes] error:", err);
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
