"use client";

// Self-only "my hours & leave" panel — surfaces keka_attendance (synced daily,
// previously read by nothing in the app at all) and keka_leave back to the
// person it's actually about, not just to managers computing availability.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RiErrorWarningLine } from "@remixicon/react";

type AttendanceRow = {
  attendance_date: string;
  total_effective_hours: number | null;
  first_in: string | null;
  last_out: string | null;
  is_absent: boolean;
};

type LeaveRow = {
  from_date: string;
  to_date: string;
  leave_type_name: string | null;
  status: number | null;
  status_label: string | null;
  note: string | null;
  requested_on: string | null;
};

type MyKekaActivity = {
  unmapped: boolean;
  summary: { daysPresent: number; daysAbsent: number; avgEffectiveHours: number | null } | null;
  attendance: AttendanceRow[];
  leave: LeaveRow[];
};

export function MyHoursLeave() {
  const [data, setData] = useState<MyKekaActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/keka/my-activity")
      .then((res) => {
        if (!res.ok) throw new Error(`request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setData(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-5 pt-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Skeleton className="h-[280px] rounded-lg" />
          <Skeleton className="h-[280px] rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pt-4">
        <EmptyState message="Couldn't load your hours and leave right now — try refreshing the page." />
      </div>
    );
  }

  if (data.unmapped) {
    return (
      <div className="pt-4">
        <EmptyState message="No Keka record found for your email — hours and leave aren't tracked here yet." />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          label="Avg Hours / Day"
          value={data.summary?.avgEffectiveHours ?? "—"}
          sub="last 30 days, days worked"
        />
        <StatCard label="Days Present" value={data.summary?.daysPresent ?? 0} sub="last 30 days" />
        <StatCard
          label="Days Absent"
          value={data.summary?.daysAbsent ?? 0}
          alert={(data.summary?.daysAbsent ?? 0) > 0}
          sub="last 30 days"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Recent Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            {data.attendance.length === 0 ? (
              <EmptyState message="No attendance recorded in the last 30 days" />
            ) : (
              <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                {data.attendance.map((row) => (
                  <AttendanceRowView key={row.attendance_date} row={row} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leave History</CardTitle>
          </CardHeader>
          <CardContent>
            {data.leave.length === 0 ? (
              <EmptyState message="No leave requests in this window" />
            ) : (
              <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                {data.leave.map((row, i) => (
                  <LeaveRowView key={`${row.from_date}-${i}`} row={row} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: number | string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-1.5 p-5",
        alert && "ring-destructive/30 bg-destructive/5 dark:bg-destructive/10",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {alert && <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />}
        {label}
      </p>
      <p
        className={cn(
          "text-3xl font-semibold tabular-nums",
          alert ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </Card>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AttendanceRowView({ row }: { row: AttendanceRow }) {
  return (
    <div className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs">
      <span className="text-foreground font-medium">{row.attendance_date}</span>
      {row.is_absent ? (
        <Badge variant="destructive">Absent</Badge>
      ) : row.total_effective_hours ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <span className="tabular-nums text-foreground">{row.total_effective_hours.toFixed(1)}h</span>
          <span className="text-[10px]">
            {fmtTime(row.first_in)}–{fmtTime(row.last_out)}
          </span>
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">Off</span>
      )}
    </div>
  );
}

function LeaveRowView({ row }: { row: LeaveRow }) {
  const range = row.from_date === row.to_date ? row.from_date : `${row.from_date} → ${row.to_date}`;
  const variant =
    row.status_label?.toLowerCase() === "approved"
      ? "secondary"
      : row.status_label?.toLowerCase() === "pending"
        ? "outline"
        : "destructive";

  return (
    <div className="py-2 first:pt-0 last:pb-0 space-y-1 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-foreground font-medium">{range}</span>
        {row.status_label && <Badge variant={variant}>{row.status_label}</Badge>}
      </div>
      {row.leave_type_name && (
        <span className="text-[10px] text-muted-foreground">{row.leave_type_name}</span>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
