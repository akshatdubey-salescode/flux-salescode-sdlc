"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiCalendarLine,
  RiExternalLinkLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiRefreshLine,
} from "@remixicon/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import type { MyMeetingsResponse } from "@/app/api/my-tasks/meetings/route";
import type { MeetingEvent } from "@/app/api/observer/boards/[boardId]/meetings/route";
import { localDateStr } from "@/lib/date-utils";

function todayStr(): string {
  return localDateStr(new Date());
}

function offsetDate(s: string, n: number): string {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

function formatRange(start: string, end: string): string {
  const fmt = (s: string) =>
    new Date(s + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function MyMeetings() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL-backed state: mstart / mend (distinct from qstart/qend used by the
  // tasks-list quarter filter so the two date ranges don't collide on shared
  // URLs).
  const start = searchParams.get("mstart") || todayStr();
  const end = searchParams.get("mend") || start;

  const updateRange = useCallback(
    (nextStart: string, nextEnd: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("mstart", nextStart);
      params.set("mend", nextEnd);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const [data, setData] = useState<MyMeetingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Bumped to force a re-fetch from the Refresh button without changing the
  // date inputs (a no-op URL update wouldn't re-trigger the effect).
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new URLSearchParams({ start, end, tz });
    fetch(`/api/my-tasks/meetings?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: MyMeetingsResponse) => {
        if (!cancelled) setData(body);
      })
      .catch(async (r) => {
        if (cancelled) return;
        const msg = r instanceof Response ? await r.text().catch(() => "") : String(r);
        setError(msg || "Failed to load meetings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end, refreshKey]);

  type Preset = "today" | "yesterday" | "thisWeek" | "last7" | "last30";

  function presetRange(preset: Preset): { start: string; end: string } {
    const t = todayStr();
    if (preset === "today") return { start: t, end: t };
    if (preset === "yesterday") {
      const y = offsetDate(t, -1);
      return { start: y, end: y };
    }
    if (preset === "thisWeek") {
      const d = new Date(t + "T12:00:00");
      const dow = d.getDay(); // 0=Sun
      const offset = dow === 0 ? 6 : dow - 1; // back to Monday
      return { start: offsetDate(t, -offset), end: offsetDate(t, 6 - offset) };
    }
    if (preset === "last7") return { start: offsetDate(t, -6), end: t };
    return { start: offsetDate(t, -29), end: t };
  }

  function applyPreset(preset: Preset) {
    const { start: s, end: e } = presetRange(preset);
    updateRange(s, e);
  }

  const activePreset: Preset | null = (() => {
    const candidates: Preset[] = ["today", "yesterday", "thisWeek", "last7", "last30"];
    for (const p of candidates) {
      const r = presetRange(p);
      if (r.start === start && r.end === end) return p;
    }
    return null;
  })();

  function shiftRange(direction: -1 | 1) {
    const days =
      (new Date(end + "T12:00:00").getTime() -
        new Date(start + "T12:00:00").getTime()) /
        86400000 +
      1;
    updateRange(
      offsetDate(start, direction * days),
      offsetDate(end, direction * days)
    );
  }

  const events = data?.events ?? [];
  const totalMinutes = data?.totalMinutes ?? 0;

  // Group events by date for the table section headers
  const grouped = useMemo(() => {
    const m = new Map<string, MeetingEvent[]>();
    for (const ev of events) {
      const key = new Date(ev.startsAt).toISOString().slice(0, 10);
      const list = m.get(key) ?? [];
      list.push(ev);
      m.set(key, list);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => shiftRange(-1)}
          aria-label="Previous range"
        >
          <RiArrowLeftSLine className="size-4" />
        </Button>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
              <RiCalendarLine className="size-3.5" />
              {formatRange(start, end)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{
                from: new Date(start + "T12:00:00"),
                to: new Date(end + "T12:00:00"),
              }}
              onSelect={(range) => {
                if (range?.from) {
                  updateRange(
                    localDateStr(range.from),
                    localDateStr(range.to ?? range.from)
                  );
                  if (range.to) setPickerOpen(false);
                }
              }}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => shiftRange(1)}
          aria-label="Next range"
        >
          <RiArrowRightSLine className="size-4" />
        </Button>

        <div className="flex items-center gap-1 ml-1">
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["thisWeek", "This week"],
              ["last7", "Last 7d"],
              ["last30", "Last 30d"],
            ] as const
          ).map(([key, label]) => {
            const isActive = activePreset === key;
            return (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
                  isActive
                    ? "bg-violet-100 text-violet-700 font-semibold dark:bg-violet-900/40 dark:text-violet-300"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {!loading && data && (
            <span>
              <span className="font-semibold text-foreground">{events.length}</span>{" "}
              {events.length === 1 ? "meeting" : "meetings"} ·{" "}
              <span className="font-semibold text-violet-700 dark:text-violet-400">
                {formatDuration(totalMinutes)}
              </span>
            </span>
          )}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <RiRefreshLine size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20 p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            If you haven&apos;t connected your calendar yet, head to{" "}
            <a href="/settings" className="underline">
              Settings
            </a>{" "}
            and click &ldquo;Connect Google Calendar&rdquo;.
          </p>
        </div>
      ) : loading && !data ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded-lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card py-16 text-center">
          <RiCalendarLine
            size={28}
            className="mx-auto mb-3 text-zinc-300 dark:text-zinc-700"
          />
          <p className="text-sm text-muted-foreground">
            No meetings in this range.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card overflow-hidden">
          {grouped.map(([dateKey, dayEvents]) => {
            const dayTotal = dayEvents.reduce((s, e) => s + e.durationMinutes, 0);
            const dayLabel = new Date(dateKey + "T12:00:00").toLocaleDateString(
              undefined,
              { weekday: "long", month: "short", day: "numeric" }
            );
            return (
              <div key={dateKey}>
                <div className="flex items-center justify-between gap-3 px-4 py-2 bg-violet-50/40 dark:bg-violet-950/10 border-b border-violet-100 dark:border-violet-900/30">
                  <div className="flex items-center gap-2">
                    <RiCalendarLine
                      size={12}
                      className="text-violet-600 dark:text-violet-400"
                    />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                      {dayLabel}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {dayEvents.length}{" "}
                    {dayEvents.length === 1 ? "meeting" : "meetings"} ·{" "}
                    {formatDuration(dayTotal)}
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead className="sr-only">
                    <tr>
                      <th>Time</th>
                      <th>Title</th>
                      <th>Organizer</th>
                      <th>Attendees</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dayEvents.map((ev) => (
                      <MeetingRow key={ev.id} event={ev} />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MeetingRow({ event }: { event: MeetingEvent }) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const timeLabel = `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const isPrivate =
    event.visibility === "private" || event.visibility === "confidential";
  const summary = event.summary ?? (isPrivate ? "(private)" : "(no title)");
  const attendeeTitle = event.attendeeEmails.join(", ");

  return (
    <tr className="hover:bg-muted/40 transition-colors">
      <td className="px-4 py-2 w-40 align-top">
        <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {timeLabel}
        </span>
      </td>
      <td className="px-3 py-2 max-w-0">
        {event.htmlLink ? (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:text-foreground/80 inline-flex items-center gap-1 max-w-full"
            title={summary}
          >
            <span className="truncate">{summary}</span>
            <RiExternalLinkLine size={10} className="opacity-60 shrink-0" />
          </a>
        ) : (
          <span className="block truncate font-medium text-foreground" title={summary}>
            {summary}
          </span>
        )}
      </td>
      <td className="px-3 py-2 w-52 max-w-0">
        <span
          className="block truncate text-muted-foreground"
          title={event.organizerEmail ?? ""}
        >
          {event.organizerEmail ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2 w-28" title={attendeeTitle}>
        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {event.attendeeEmails.length > 0
            ? `${event.attendeeEmails.length}`
            : "Solo"}
        </span>
      </td>
      <td className="px-4 py-2 w-24 text-right">
        <span className="font-medium text-violet-700 dark:text-violet-400 whitespace-nowrap">
          {formatDuration(event.durationMinutes)}
        </span>
      </td>
    </tr>
  );
}
