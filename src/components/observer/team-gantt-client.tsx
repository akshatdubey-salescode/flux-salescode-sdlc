"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiRefreshLine,
  RiInboxLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import type {
  TimelineResponse,
  TimelineIssue,
  IssueLabel,
} from "@/app/api/observer/boards/[boardId]/timeline/route";
import type {
  MeetingsResponse,
  MeetingEvent,
} from "@/app/api/observer/boards/[boardId]/meetings/route";

// ---------------------------------------------------------------------------
// Date helpers — all timezone-safe (local time, T12:00:00)
// ---------------------------------------------------------------------------
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() {
  return localDateStr(new Date());
}
function offsetDate(s: string, n: number): string {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) /
      86400000
  );
}
function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T12:00:00").getDay();
  return day === 0 || day === 6;
}
function formatDayLabel(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}
function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// Layout (px)
const MEMBER_COL_W = 180;
const SLOT_W = 54;   // width per half-day slot (AM or PM)
const ROW_H = 36;    // height per issue row
const HDR1_H = 30;   // day-name header row
const HDR2_H = 22;   // AM/PM sub-header row
const BAR_INSET = 3; // vertical inset inside each row

const BAR_CLASSES: Record<IssueLabel, string> = {
  on_track: "bg-blue-500 hover:bg-blue-600 text-white",
  at_risk:  "bg-amber-400 hover:bg-amber-500 text-amber-950",
  overdue:  "bg-red-500 hover:bg-red-600 text-white",
  done:     "bg-emerald-500 hover:bg-emerald-600 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500",
};


function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function issueTypeSummary(bars: BarDatum[]): string {
  if (bars.length === 0) return "No issues";
  const counts: Record<string, number> = {};
  for (const bar of bars) {
    const t = bar.issue.issueType || "Issue";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, n]) => `${n} ${type}${n > 1 ? "s" : ""}`)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Gantt grid
// ---------------------------------------------------------------------------
type BarDatum = {
  issue: TimelineIssue;
  startSlot: number;
  endSlot: number;
};

type TooltipInfo = {
  issue: TimelineIssue;
  x: number;
  y: number;
};

// Height of the meeting row beneath each member's issue bars. Only rendered
// when the member has at least one meeting in the visible range; otherwise
// the row height is unchanged. Tall enough to fit a "1h 30m" label legibly.
const MEETING_STRIP_H = 22;

function GanttGrid({
  data,
  meetingsByEmail,
  rangeStart,
  rangeEnd,
}: {
  data: TimelineResponse;
  meetingsByEmail: Record<string, MeetingEvent[]>;
  rangeStart: string;
  rangeEnd: string;
}) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const today = todayStr();

  const numDays = daysBetween(rangeStart, rangeEnd) + 1;
  const totalSlots = numDays * 2;
  const totalTrackW = totalSlots * SLOT_W;
  const days = Array.from({ length: numDays }, (_, i) => offsetDate(rangeStart, i));

  // Today vertical marker: between AM and PM slots of today
  let todayX: number | null = null;
  if (today >= rangeStart && today <= rangeEnd) {
    const dayIdx = daysBetween(rangeStart, today);
    todayX = (dayIdx * 2 + 1) * SLOT_W;
  }

  // Build bar data per member + bucket meetings per day for the density strip.
  const rowData = data.members.map((member) => {
    const bars: BarDatum[] = member.issues.map((issue) => {
      const clampedStart = issue.startDate < rangeStart ? rangeStart : issue.startDate;
      const clampedEnd = issue.dueDate > rangeEnd ? rangeEnd : issue.dueDate;
      const startSlot = Math.max(0, daysBetween(rangeStart, clampedStart) * 2);
      const endSlot = Math.min(totalSlots - 1, daysBetween(rangeStart, clampedEnd) * 2 + 1);
      return { issue, startSlot, endSlot };
    });

    const memberMeetings =
      meetingsByEmail[member.email.toLowerCase()] ?? [];
    const dayBuckets: Record<string, { minutes: number; events: MeetingEvent[] }> = {};
    for (const ev of memberMeetings) {
      const dateKey = new Date(ev.startsAt).toLocaleDateString("en-CA"); // YYYY-MM-DD local
      if (dateKey < rangeStart || dateKey > rangeEnd) continue;
      const bucket = dayBuckets[dateKey] ?? { minutes: 0, events: [] };
      bucket.minutes += ev.durationMinutes;
      bucket.events.push(ev);
      dayBuckets[dateKey] = bucket;
    }
    return { member, bars, dayBuckets };
  });

  const headerH = HDR1_H + HDR2_H;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Fixed tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl p-3 w-72 text-xs"
          style={{
            left: Math.min(tooltip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 304),
            top: tooltip.y - 10,
          }}
        >
          <p className="font-semibold text-zinc-900 dark:text-zinc-50 leading-snug mb-1.5">
            {tooltip.issue.summary}
          </p>
          <div className="flex items-center gap-1.5 text-muted-foreground flex-wrap">
            <a
              href={`${tooltip.issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${tooltip.issue.jiraKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono font-bold text-primary hover:underline flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              {tooltip.issue.jiraKey}
              <RiExternalLinkLine size={9} />
            </a>
            <span>·</span>
            <span>{tooltip.issue.status}</span>
            {tooltip.issue.priority && (
              <>
                <span>·</span>
                <span>{tooltip.issue.priority}</span>
              </>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate">{tooltip.issue.projectName}</p>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1.5 font-medium">
            {fmtDate(tooltip.issue.startDate)} → {fmtDate(tooltip.issue.dueDate)}
          </p>
        </div>
      )}

      <div className="flex bg-white dark:bg-zinc-900/50">
        {/* Sticky member column */}
        <div
          className="shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50"
          style={{ width: MEMBER_COL_W }}
        >
          {/* Header spacer matching grid headers */}
          <div
            className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80"
            style={{ height: headerH }}
          />
          {/* One cell per member */}
          {rowData.map(({ member, bars, dayBuckets }) => {
            const hasMeetings = Object.keys(dayBuckets).length > 0;
            const memberRowH =
              Math.max(1, bars.length) * ROW_H + (hasMeetings ? MEETING_STRIP_H : 0);
            return (
            <div
              key={member.memberId}
              className="flex items-center gap-2.5 px-3 border-b border-zinc-100 dark:border-zinc-800/50"
              style={{ height: memberRowH }}
            >
              <div className="size-7 shrink-0 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                {initials(member.name)}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate leading-tight">
                  {member.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {issueTypeSummary(bars)}
                </p>
              </div>
            </div>
            );
          })}
        </div>

        {/* Scrollable grid */}
        <div className="overflow-x-auto flex-1">
          <div style={{ width: totalTrackW }}>
            {/* Day name header */}
            <div
              className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80"
              style={{ height: HDR1_H }}
            >
              {days.map((day) => (
                <div
                  key={day}
                  className={`flex items-center justify-center border-r text-[11px] font-semibold shrink-0
                    ${day === today ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}
                    ${isWeekend(day) ? "bg-zinc-100/70 dark:bg-zinc-800/30" : ""}
                    border-zinc-200 dark:border-zinc-800`}
                  style={{ width: SLOT_W * 2 }}
                >
                  {formatDayLabel(day)}
                </div>
              ))}
            </div>

            {/* AM/PM sub-header */}
            <div
              className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80"
              style={{ height: HDR2_H }}
            >
              {days.map((day) => (
                <div key={day} className="flex shrink-0" style={{ width: SLOT_W * 2 }}>
                  <div
                    className={`flex-1 flex items-center justify-center text-[9px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-600 border-r border-zinc-100 dark:border-zinc-800/50
                      ${isWeekend(day) ? "bg-zinc-100/70 dark:bg-zinc-800/30" : ""}`}
                  >
                    AM
                  </div>
                  <div
                    className={`flex-1 flex items-center justify-center text-[9px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-600 border-r border-zinc-200 dark:border-zinc-800
                      ${isWeekend(day) ? "bg-zinc-100/70 dark:bg-zinc-800/30" : ""}`}
                  >
                    PM
                  </div>
                </div>
              ))}
            </div>

            {/* Member rows */}
            {rowData.map(({ member, bars, dayBuckets }) => {
              const numRows = Math.max(1, bars.length);
              const issuesAreaH = numRows * ROW_H;
              const hasMeetings = Object.keys(dayBuckets).length > 0;
              const rowH = issuesAreaH + (hasMeetings ? MEETING_STRIP_H : 0);

              return (
                <div
                  key={member.memberId}
                  className="relative border-b border-zinc-100 dark:border-zinc-800/50"
                  style={{ height: rowH, width: totalTrackW }}
                >
                  {/* Background column bands */}
                  {days.map((day, di) => (
                    <div
                      key={day}
                      className={`absolute top-0 bottom-0 ${
                        day === today
                          ? "bg-red-50/30 dark:bg-red-950/10"
                          : isWeekend(day)
                          ? "bg-zinc-50/60 dark:bg-zinc-800/15"
                          : ""
                      }`}
                      style={{ left: di * SLOT_W * 2, width: SLOT_W * 2 }}
                    />
                  ))}

                  {/* Vertical grid lines */}
                  {days.map((day, di) => (
                    <div
                      key={`${day}-lines`}
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{ left: di * SLOT_W * 2, width: SLOT_W * 2 }}
                    >
                      <div
                        className="absolute top-0 bottom-0 w-px bg-zinc-100 dark:bg-zinc-800/40"
                        style={{ left: SLOT_W }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-700/50"
                        style={{ left: SLOT_W * 2 - 1 }}
                      />
                    </div>
                  ))}

                  {/* Today marker */}
                  {todayX !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-400/80 z-10 pointer-events-none"
                      style={{ left: todayX }}
                    />
                  )}

                  {/* Issue bars */}
                  {bars.length === 0 ? (
                    <div className="absolute inset-0 flex items-center px-4">
                      <span className="text-[11px] text-muted-foreground/40 italic">
                        No issues in this range
                      </span>
                    </div>
                  ) : (
                    bars.map((bar, idx) => {
                      const left = bar.startSlot * SLOT_W;
                      const width = Math.max(
                        (bar.endSlot - bar.startSlot + 1) * SLOT_W,
                        SLOT_W
                      );
                      const top = idx * ROW_H + BAR_INSET;
                      const height = ROW_H - BAR_INSET * 2;

                      return (
                        <div
                          key={bar.issue.id}
                          className={`absolute flex items-center px-2 rounded cursor-pointer transition-opacity select-none ${BAR_CLASSES[bar.issue.label]}`}
                          style={{ left, width, top, height }}
                          onMouseEnter={(e) =>
                            setTooltip({ issue: bar.issue, x: e.clientX, y: e.clientY })
                          }
                          onMouseMove={(e) =>
                            setTooltip((t) =>
                              t ? { ...t, x: e.clientX, y: e.clientY } : null
                            )
                          }
                          onMouseLeave={() => setTooltip(null)}
                          onClick={() => {
                            window.open(
                              `${bar.issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${bar.issue.jiraKey}`,
                              "_blank",
                              "noopener,noreferrer"
                            );
                          }}
                        >
                          <span className="text-[10px] font-bold truncate leading-none">
                            {bar.issue.jiraKey}
                          </span>
                        </div>
                      );
                    })
                  )}

                  {/* Meeting row — per day, split into AM and PM half-slots
                      matching the column header above. Each occupied half
                      renders a violet pill with the total minutes in that
                      half; empty halves stay blank so the row reads at a
                      glance ("busy mornings", "back-to-back Thu PM", etc.). */}
                  {hasMeetings && (
                    <div
                      className="absolute left-0 right-0 flex bg-violet-50/30 dark:bg-violet-950/10 border-t border-violet-100 dark:border-violet-900/30"
                      style={{ top: issuesAreaH, height: MEETING_STRIP_H }}
                    >
                      {days.map((day) => {
                        const bucket = dayBuckets[day];
                        if (!bucket) {
                          return (
                            <div
                              key={day}
                              className="border-r border-zinc-100 dark:border-zinc-800/40"
                              style={{ width: SLOT_W * 2 }}
                            />
                          );
                        }
                        const amMins = bucket.events
                          .filter((e) => new Date(e.startsAt).getHours() < 12)
                          .reduce((s, e) => s + e.durationMinutes, 0);
                        const pmMins = bucket.minutes - amMins;
                        const tooltip = bucket.events
                          .map((e) => {
                            const t = new Date(e.startsAt).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" }
                            );
                            return `${t} · ${e.summary ?? "(private)"} (${e.durationMinutes}m)`;
                          })
                          .join("\n");
                        return (
                          <div
                            key={day}
                            className="flex border-r border-zinc-100 dark:border-zinc-800/40"
                            style={{ width: SLOT_W * 2 }}
                            title={`${formatMinutes(bucket.minutes)} in meetings\n${tooltip}`}
                          >
                            <div className="flex-1 p-0.5">
                              {amMins > 0 && (
                                <div className="h-full rounded-sm bg-violet-500 dark:bg-violet-600 text-white text-[9px] font-semibold flex items-center justify-center cursor-help leading-none px-1">
                                  {formatMinutes(amMins)}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 p-0.5">
                              {pmMins > 0 && (
                                <div className="h-full rounded-sm bg-violet-500 dark:bg-violet-600 text-white text-[9px] font-semibold flex items-center justify-center cursor-help leading-none px-1">
                                  {formatMinutes(pmMins)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — dates are controlled by the parent (TeamTimelineClient)
// ---------------------------------------------------------------------------
type Props = { boardId: string; start: string; end: string };

export function TeamGanttClient({ boardId, start, end }: Props) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [meetingsByEmail, setMeetingsByEmail] = useState<
    Record<string, MeetingEvent[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (s: string, e: string) => {
      setLoading(true);
      setError(null);
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const [timelineRes, meetingsRes] = await Promise.all([
          fetch(`/api/observer/boards/${boardId}/timeline?start=${s}&end=${e}`),
          fetch(
            `/api/observer/boards/${boardId}/meetings?start=${s}&end=${e}&tz=${encodeURIComponent(tz)}`
          ),
        ]);
        if (timelineRes.ok) {
          setData(await timelineRes.json());
        } else {
          const body = await timelineRes.json().catch(() => ({}));
          setError(body.error ?? `Error ${timelineRes.status}`);
        }
        // Meetings are non-critical; render Gantt even if this fails.
        if (meetingsRes.ok) {
          const body: MeetingsResponse = await meetingsRes.json();
          const map: Record<string, MeetingEvent[]> = {};
          for (const m of body.byMember) {
            map[m.email.toLowerCase()] = m.events;
          }
          setMeetingsByEmail(map);
        }
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    },
    [boardId]
  );

  useEffect(() => {
    load(start, end);
  }, [start, end, load]);

  const numDays = daysBetween(start, end) + 1;

  return (
    <div>
      {/* Info + legend row */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <span className="text-xs text-muted-foreground">
          Showing{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            {fmtDate(start)}
          </span>
          {numDays > 1 && (
            <>
              {" → "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {fmtDate(end)}
              </span>
            </>
          )}
          {" "}({numDays}d)
        </span>

        <div className="ml-auto flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground">
            {(
              [
                ["bg-blue-500", "On Track"],
                ["bg-amber-400", "At Risk"],
                ["bg-red-500", "Overdue"],
                ["bg-emerald-500 dark:bg-emerald-600", "Done"],
                ["bg-violet-500 dark:bg-violet-400", "Meetings"],
              ] as [string, string][]
            ).map(([bg, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className={`inline-block size-2.5 rounded-sm ${bg}`} />
                {label}
              </span>
            ))}
          </div>

          <button
            onClick={() => load(start, end)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RiRefreshLine size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="py-8 text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <button
            onClick={() => load(start, end)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Try again
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="h-64 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl animate-pulse" />
      )}

      {!error && !loading && data?.members.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <RiInboxLine size={28} className="text-zinc-300 dark:text-zinc-700 mb-3" />
          <p className="text-sm text-muted-foreground">No members on this board yet.</p>
        </div>
      )}

      {data && data.members.length > 0 && (
        <GanttGrid
          data={data}
          meetingsByEmail={meetingsByEmail}
          rangeStart={start}
          rangeEnd={end}
        />
      )}
    </div>
  );
}
