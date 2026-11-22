import { timingSafeEqual } from "node:crypto";
import { runMovementCheck } from "@/lib/movement/cron";

// The periodic check of the environment movements: re-reads the deployment records of the movements
// that are ready / signed off / in progress (at most 8 per run, 2 at a time, none refreshed in the
// last 25 minutes) so a changed record resets the sign-offs without anybody opening the page. Exits
// at once when nothing is due.
//
// Bearer CRON_SECRET guard, mirroring the other cron routes. It is NOT in vercel.json (Vercel Hobby only
// allows daily crons): the external scheduler calls it every 30 minutes, see docs/scheduled-processes.md.
// GET (what Vercel Cron would issue) and POST are both handled. The response holds counts only.
export const maxDuration = 800; // Vercel caps this to the plan's actual max if lower. The run stops starting work after 240 s and gives each refresh 120 s (see lib/movement/cron.ts); keep this above their sum.

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runMovementCheck();
    // Non-2xx only when the selection itself failed, so a cron monitor alerts; per-movement errors are counted in the body.
    return Response.json(summary, { status: summary.selectionFailed ? 500 : 200 });
  } catch (err) {
    console.error("[cron/movements] error:", err instanceof Error ? err.message.slice(0, 160) : "error");
    return Response.json({ error: "Movement check failed." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
