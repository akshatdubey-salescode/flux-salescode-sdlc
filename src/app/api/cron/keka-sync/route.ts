import { revalidateTag } from "next/cache";
import {
  KEKA_ATTENDANCE_TAG,
  KEKA_DIRECTORY_TAG,
  KEKA_LEAVE_TAG,
} from "@/lib/keka/cache-tags";
import { syncKekaEmployees } from "@/lib/keka/sync";
import { syncKekaAttendance } from "@/lib/keka/attendance-sync";
import { syncKekaLeave } from "@/lib/keka/leave-sync";

// Bearer CRON_SECRET guard, mirroring the github-sync / calendar-sync crons. The
// schedule is registered the same way theirs is (no vercel.json in-repo) and
// must send `Authorization: Bearer ${CRON_SECRET}`. Daily is ample — the Keka
// directory changes slowly (joiners/leavers/role moves) and the pull is small.
//
// Runs the sync inline (the directory is small, like the superuser "Sync now"
// button). The heavy first-ever population is still best done via
// `pnpm sync:keka` (no serverless time limit). This is the directory's only
// automated refresh — before this route it was manual-button / CLI only.
function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Directory first — it builds the employee_number→GUID map attendance links
    // against, and is the more critical of the two.
    const directory = await syncKekaEmployees();
    // Refresh directory-derived surfaces (org context everywhere) post-pull.
    revalidateTag(KEKA_DIRECTORY_TAG, "max");

    // Attendance is secondary: a failure here must NOT fail the directory pull,
    // so it's caught and reported inline rather than thrown. -15/+15 window
    // keeps recent absence fresh AND surfaces upcoming weekly-offs/holidays;
    // heavy backfills run via script.
    let attendance:
      | Awaited<ReturnType<typeof syncKekaAttendance>>
      | { error: string };
    try {
      // Short trailing+forward window keeps the daily run under Keka's 50/min
      // quota and the serverless time limit; historical backfill is done via
      // the script.
      attendance = await syncKekaAttendance({ trailingDays: 15, forwardDays: 15 });
      revalidateTag(KEKA_ATTENDANCE_TAG, "max");
    } catch (err) {
      attendance = { error: err instanceof Error ? err.message : String(err) };
    }

    // Leave — the authoritative "on leave" source. Pulls a trailing+forward
    // window (default -30/+60d) so upcoming leave shows on the Gantt. Isolated
    // so a failure here doesn't fail the directory/attendance pulls.
    let leave: Awaited<ReturnType<typeof syncKekaLeave>> | { error: string };
    try {
      leave = await syncKekaLeave();
      revalidateTag(KEKA_LEAVE_TAG, "max");
    } catch (err) {
      leave = { error: err instanceof Error ? err.message : String(err) };
    }

    return Response.json({ directory, attendance, leave });
  } catch (err) {
    // Surface the failure with a non-2xx status so a cron monitor can alert.
    // invalid_grant from stale/throttled Keka creds is the usual culprit.
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ error }, { status: 500 });
  }
}
