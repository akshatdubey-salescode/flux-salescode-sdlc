// Pure summary-stat computation over a window of raw keka_attendance rows —
// extracted so the "average hours / days present / days absent" arithmetic is
// unit-testable without a DB. isAbsent is trusted as-is from the row (it's
// already a derived, day-type-aware heuristic computed at sync time — see
// schema.ts's comment on keka_attendance — not re-derived here).

export type AttendanceRow = {
  attendanceDate: string;
  totalEffectiveHours: number | null;
  isAbsent: boolean;
};

export type AttendanceSummary = {
  daysPresent: number;
  daysAbsent: number;
  avgEffectiveHours: number | null;
};

export function summarizeAttendance(rows: AttendanceRow[]): AttendanceSummary {
  // "Present" means actual logged hours, not just "!isAbsent" — a weekly-off
  // or holiday row is also !isAbsent (nothing was expected of them that day)
  // but has no real hours either, so it shouldn't inflate a "days present"
  // count the way an actual working day should.
  const hoursLogged = rows
    .map((r) => r.totalEffectiveHours)
    .filter((h): h is number => h != null && h > 0);

  const avgEffectiveHours =
    hoursLogged.length === 0
      ? null
      : Math.round((hoursLogged.reduce((s, h) => s + h, 0) / hoursLogged.length) * 10) / 10;

  return {
    daysPresent: hoursLogged.length,
    daysAbsent: rows.filter((r) => r.isAbsent).length,
    avgEffectiveHours,
  };
}
