"use client";

import { useState } from "react";
import { format } from "date-fns";
import { RiCalendarLine, RiTimeLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fromIstInputValue, formatIstDateTime, toIstInputValue } from "@/lib/support/ist-input";

// App-styled replacements for the browser's datetime-local / time inputs.
// Values stay in the same `YYYY-MM-DDTHH:mm` IST wall-time format the
// ist-input helpers use, so callers convert exactly as before.

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

/** Calendar-day Date (local midnight) for a `YYYY-MM-DD…` string — display only. */
function dayOf(v: string): Date {
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function TimeSelects({
  hour,
  minute,
  onHour,
  onMinute,
  hours = HOURS,
  minuteDisabled = false,
  label,
}: {
  hour: string;
  minute: string;
  onHour: (h: string) => void;
  onMinute: (m: string) => void;
  hours?: string[];
  minuteDisabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Select value={hour} onValueChange={onHour}>
        <SelectTrigger size="sm" className="w-[68px]" aria-label={`${label} hour`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {hours.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select value={minute} onValueChange={onMinute} disabled={minuteDisabled}>
        <SelectTrigger size="sm" className="w-[68px]" aria-label={`${label} minute`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Date + time picker in IST. `value` / `onChange` use `YYYY-MM-DDTHH:mm`
 * (IST wall time) or null. Changes apply on "Set", not on every click.
 */
export function IstDateTimePicker({
  value,
  onChange,
  label,
  placeholder = "Set date & time",
  noFuture = false,
  allowClear = false,
  size = "default",
  className,
  id,
  emptyDraft,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  placeholder?: string;
  /** Disable days after today and clamp the time to now. */
  noFuture?: boolean;
  allowClear?: boolean;
  size?: "sm" | "default";
  className?: string;
  id?: string;
  /** Where the picker starts when `value` is null (IST wall time); defaults to now. */
  emptyDraft?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? emptyDraft ?? toIstInputValue(new Date()));

  function onOpenChange(next: boolean) {
    if (next) setDraft(value ?? emptyDraft ?? toIstInputValue(new Date()));
    setOpen(next);
  }

  const nowIst = toIstInputValue(new Date());
  const hour = draft.slice(11, 13);
  const minute = draft.slice(14, 16);
  const tooLate = noFuture && draft > nowIst;

  function apply() {
    if (tooLate) return;
    setOpen(false);
    // Empty field opened on its fallback (e.g. the Jira time) and set unchanged: nothing to save.
    if (value === null && emptyDraft !== undefined && draft === emptyDraft) return;
    if (draft !== value) onChange(draft);
  }

  const shown = value ? fromIstInputValue(value) : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          aria-label={label}
          title={`${label} (IST)`}
          className={cn("justify-start font-normal", size === "sm" ? "h-7 w-44 text-xs" : "w-full", className)}
        >
          <RiCalendarLine className="text-muted-foreground" />
          {shown ? (
            <span>{formatIstDateTime(shown.toISOString())}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dayOf(draft)}
          defaultMonth={dayOf(draft)}
          disabled={noFuture ? { after: dayOf(nowIst) } : undefined}
          onSelect={(d) => {
            if (d) setDraft(`${format(d, "yyyy-MM-dd")}${draft.slice(10)}`);
          }}
        />
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2.5">
          <div className="flex items-center gap-2">
            <RiTimeLine className="size-4 text-muted-foreground" />
            <TimeSelects
              label={label}
              hour={hour}
              minute={minute}
              onHour={(h) => setDraft(`${draft.slice(0, 11)}${h}${draft.slice(13)}`)}
              onMinute={(m) => setDraft(`${draft.slice(0, 14)}${m}`)}
            />
            <span className="text-xs text-muted-foreground">IST</span>
          </div>
        </div>
        {tooLate && (
          <p className="px-3 pb-1 text-xs text-destructive">That time is in the future.</p>
        )}
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDraft(toIstInputValue(new Date()))}>
              Now
            </Button>
            {allowClear && value !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setOpen(false);
                  onChange(null);
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <Button size="sm" onClick={apply} disabled={tooLate}>
            Set
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * `HH:MM` picker for office hours. With `allowEndOfDay`, hour "24" is offered
 * (meaning midnight at the end of the day) and forces minutes to "00".
 */
export function TimeOfDayPicker({
  value,
  onChange,
  label,
  allowEndOfDay = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  allowEndOfDay?: boolean;
}) {
  const [h, m] = value.split(":");
  const hours = allowEndOfDay ? [...HOURS, "24"] : HOURS;
  return (
    <TimeSelects
      label={label}
      hours={hours}
      hour={h}
      minute={h === "24" ? "00" : m}
      minuteDisabled={h === "24"}
      onHour={(nh) => onChange(`${nh}:${nh === "24" ? "00" : m}`)}
      onMinute={(nm) => onChange(`${h}:${nm}`)}
    />
  );
}
