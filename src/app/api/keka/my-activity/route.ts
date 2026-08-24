import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { KEKA_ATTENDANCE_TAG, KEKA_LEAVE_TAG, KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";
import { summarizeAttendance } from "@/lib/keka/my-attendance-stats";

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json(await fetchMyKekaActivity(user.email));
  } catch (error) {
    console.error("My Keka activity error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

/**
 * The signed-in person's own attendance (last 30 days) and leave history
 * (past 90 days through the next 90) — data that's fully synced daily
 * (keka-sync cron) but, before this, was never read back anywhere in the app;
 * keka_attendance had zero readers. unmapped=true means this email has no
 * row in keka_employees at all (e.g. a contractor not in Keka), which is a
 * different, honest story from "no attendance recorded."
 */
async function fetchMyKekaActivity(userEmail: string) {
  "use cache";
  cacheLife("minutes");
  // KEKA_DIRECTORY_TAG too — this reads keka_employees for the
  // email->employeeNumber mapping, so an admin fixing a wrong mapping needs
  // this to refresh alongside the directory sync, not just attendance/leave.
  cacheTag(KEKA_ATTENDANCE_TAG, KEKA_LEAVE_TAG, KEKA_DIRECTORY_TAG);

  const empRes = await db.execute(sql`
    SELECT employee_number FROM keka_employees WHERE lower(email) = lower(${userEmail}) LIMIT 1
  `);
  const employeeNumber = empRes.rows[0]?.employee_number as string | undefined;

  if (!employeeNumber) {
    return { unmapped: true, summary: null, attendance: [], leave: [] };
  }

  const [attendanceRes, leaveRes] = await Promise.all([
    db.execute(sql`
      SELECT
        to_char(attendance_date, 'YYYY-MM-DD') AS attendance_date,
        total_effective_hours,
        first_in,
        last_out,
        is_absent
      FROM keka_attendance
      WHERE employee_number = ${employeeNumber}
        AND attendance_date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY attendance_date DESC
    `),
    db.execute(sql`
      SELECT
        to_char(from_date, 'YYYY-MM-DD') AS from_date,
        to_char(to_date, 'YYYY-MM-DD') AS to_date,
        leave_type_name,
        status,
        status_label,
        note,
        requested_on
      FROM keka_leave
      WHERE employee_number = ${employeeNumber}
        AND to_date >= CURRENT_DATE - INTERVAL '90 days'
        AND from_date <= CURRENT_DATE + INTERVAL '90 days'
      ORDER BY from_date DESC
      LIMIT 20
    `),
  ]);

  const attendance = attendanceRes.rows as {
    attendance_date: string;
    total_effective_hours: number | null;
    first_in: string | null;
    last_out: string | null;
    is_absent: boolean;
  }[];

  const summary = summarizeAttendance(
    attendance.map((r) => ({
      attendanceDate: r.attendance_date,
      totalEffectiveHours: r.total_effective_hours,
      isAbsent: r.is_absent,
    })),
  );

  return {
    unmapped: false,
    summary,
    attendance,
    leave: leaveRes.rows,
  };
}
