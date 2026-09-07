"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiMailSendLine, RiRepeat2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SprintWithItems } from "@/lib/sprints/entries";
import { ScheduleList } from "@/components/scheduled-processes/schedule-list";
import { usePersonSearch, type KnownPerson } from "@/hooks/use-person-search";
import { istToday, nextRunAfter } from "@/lib/scheduled-processes/recurrence";
import {
  SCHEDULE_FREQUENCY_VALUES,
  WEEKDAY_LABELS,
  describeCadence,
  ordinal,
  validateCadence,
  type CadenceSpec,
  type ScheduleFrequency,
  type ScheduleRow,
} from "@/lib/scheduled-processes/types";
import { Tip } from "./tip";

type Stakeholder = { id: string; name: string; email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Tab = "compose" | "preview" | "schedule";

/** Prefilled subject + message for a sprint update. */
export function sprintEmailDefaults(sprint: SprintWithItems): { subject: string; message: string } {
  const r = sprint.rollup;
  const subject =
    sprint.startedAt && r.committed > 0
      ? `Sprint update: ${sprint.name} — ${Math.round((r.committedDone / r.committed) * 100)}% of commitment done (${sprint.startDate} → ${sprint.endDate})`
      : `Sprint update: ${sprint.name} (${sprint.startDate} → ${sprint.endDate})`;
  return {
    subject,
    message: `Hi,\n\nSharing the latest progress on ${sprint.name}. The summary is below and the detailed report is attached.`,
  };
}

/** Prefilled subject + message for a workstream update. */
export function workstreamEmailDefaults(
  name: string,
  sprints: SprintWithItems[]
): { subject: string; message: string } {
  const committed = sprints.reduce((n, s) => n + s.rollup.committed, 0);
  const committedDone = sprints.reduce((n, s) => n + s.rollup.committedDone, 0);
  const subject =
    committed > 0
      ? `Workstream update: ${name} — ${Math.round((committedDone / committed) * 100)}% of commitment done across ${sprints.length} sprint${sprints.length === 1 ? "" : "s"}`
      : `Workstream update: ${name} (${sprints.length} sprint${sprints.length === 1 ? "" : "s"})`;
  return {
    subject,
    message: `Hi,\n\nSharing the latest progress on the ${name} workstream. The summary across its sprints is below and the detailed report is attached.`,
  };
}

/**
 * "Send progress to stakeholders" for a sprint or a workstream, once or on a
 * repeat: recipients from the project's stakeholder list plus anyone known to
 * the system (typeahead over the same org-wide directory the Team Pulse member
 * picker uses) or a raw email; the subject and top message are prefilled and
 * editable; the auto-generated progress view + Excel report ride along.
 *
 * The Repeat tab turns the very same compose state into a standing schedule
 * that the midnight run sends — one form, so a recurring update is composed
 * and previewed exactly like the one-off it repeats.
 */
export function EmailUpdateDialog({
  endpoint,
  schedulesEndpoint,
  projectId,
  entityName,
  buildDefaults,
}: {
  /** POST target: /api/sprints/[id]/email or /api/workstreams/[id]/email. */
  endpoint: string;
  /**
   * GET/POST target for standing schedules, e.g. /api/sprints/[id]/schedules.
   * Omitted where scheduling isn't wired up yet (workstreams) — the Repeat tab
   * simply doesn't appear.
   */
  schedulesEndpoint?: string;
  /** Owning project for the stakeholder prefill; null for board sprints. */
  projectId: string | null;
  /** Shown in the dialog copy ("progress of X"). */
  entityName: string;
  /** Computes the prefilled subject/message from live data when the dialog opens. */
  buildDefaults: () => { subject: string; message: string };
}) {
  const [open, setOpen] = useState(false);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [extraRecipients, setExtraRecipients] = useState<KnownPerson[]>([]);
  // Shared with the schedule list's recipients editor, so both pickers search
  // the same directory the same way.
  const {
    query: personQuery,
    setQuery: setPersonQuery,
    suggestions,
    clear: clearPersonSearch,
  } = usePersonSearch();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<Tab>("compose");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [endsOn, setEndsOn] = useState("");
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /** Cleared once the user types in the subject box, so we stop overwriting it. */
  const subjectUntouched = useRef(true);

  // Prefill the editable content when the dialog opens, from live data.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const defaults = buildDefaults();
      setSubject(defaults.subject);
      setMessage(defaults.message);
      setTab("compose");
      setPreview(null);
      subjectUntouched.current = true;
      // buildDefaults gives an instant, offline-safe subject; the authoritative
      // one — the only copy that quotes live risk counts — is composed on the
      // server. Ask for it and swap it in, unless the user is already typing.
      void loadServerSubject();
      void loadSchedules();
    }
  }

  /** What's already scheduled on this sprint — the Repeat tab's list. */
  async function loadSchedules() {
    if (!schedulesEndpoint) return;
    try {
      const res = await fetch(schedulesEndpoint, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { schedules: ScheduleRow[] };
      setSchedules(data.schedules ?? []);
    } catch {
      // A failed list shouldn't block composing — the tab just shows none.
    }
  }

  /**
   * The server's own default subject, fetched by previewing with an empty
   * subject. Without this the box would send a client-side approximation and
   * the risk clause the server puts in the subject line would never ship.
   */
  async function loadServerSubject() {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, subject: "", message: "" }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { subject?: string };
      if (data.subject && subjectUntouched.current) setSubject(data.subject);
    } catch {
      // Keep the buildDefaults fallback already in the box.
    }
  }

  // The preview is rendered by the SAME server code that sends — what comes
  // back is byte-for-byte the email a send would produce with these edits.
  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, subject: subject.trim(), message }),
      });
      if (!res.ok) throw new Error();
      setPreview((await res.json()) as { subject: string; html: string });
    } catch {
      setPreview(null);
      toast.error("Couldn't load the preview — try again");
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleTabChange(value: string) {
    setTab(value as Tab);
    if (value === "preview") void loadPreview();
    if (value === "schedule") void loadSchedules();
  }

  // Project stakeholders pre-fill the recipient list (all selected by
  // default); board sprints have no stakeholder list, so it's picker-only.
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/stakeholders`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Stakeholder[]) => {
        if (cancelled) return;
        setStakeholders(rows);
        setChecked(new Set(rows.map((s) => s.email.toLowerCase())));
      })
      .catch(() => {
        if (!cancelled) setStakeholders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const chosenEmails = useMemo(
    () => new Set([...checked, ...extraRecipients.map((p) => p.email.toLowerCase())]),
    [checked, extraRecipients]
  );
  const recipients = [...chosenEmails];

  function addPerson(p: KnownPerson) {
    const key = p.email.toLowerCase();
    if (!chosenEmails.has(key)) {
      setExtraRecipients((cur) => [...cur, { name: p.name, email: key }]);
    }
    clearPersonSearch();
  }

  function handlePersonKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = personQuery.trim().toLowerCase();
    if (suggestions.length > 0) {
      addPerson(suggestions[0]);
    } else if (EMAIL_RE.test(q)) {
      // Not in the system (e.g. an external client) — raw email is fine.
      addPerson({ name: q.split("@")[0], email: q });
    }
  }

  function toggle(email: string) {
    setChecked((cur) => {
      const next = new Set(cur);
      const key = email.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSend() {
    if (recipients.length === 0 || !subject.trim() || !message.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, subject: subject.trim(), message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to send the update");
        return;
      }
      toast.success(
        `Progress update sent to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"} with the detailed report attached`
      );
      setOpen(false);
      setExtraRecipients([]);
      clearPersonSearch();
    } finally {
      setSending(false);
    }
  }

  const cadence: CadenceSpec = { frequency, dayOfWeek, dayOfMonth };
  const cadenceError = validateCadence(cadence);
  // Same function the server uses to stamp next_run_on, so the date promised
  // here is the date the row will actually carry.
  const firstSend = nextRunAfter(cadence, istToday(), endsOn || null);
  const canSchedule =
    !!schedulesEndpoint &&
    recipients.length > 0 &&
    !!subject.trim() &&
    !!message.trim() &&
    !cadenceError &&
    !("ended" in firstSend) &&
    !scheduling;

  async function handleSchedule() {
    if (!schedulesEndpoint || !canSchedule) return;
    setScheduling(true);
    try {
      const res = await fetch(schedulesEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          subject: subject.trim(),
          message,
          frequency,
          dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
          dayOfMonth: frequency === "monthly" ? dayOfMonth : null,
          endsOn: endsOn || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't save the schedule");
        return;
      }
      toast.success(`Scheduled — ${describeCadence(cadence).toLowerCase()}`);
      void loadSchedules();
    } finally {
      setScheduling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tip label={`Email the progress of ${entityName} to stakeholders — summary inline, detailed Excel report attached`}>
        <DialogTrigger asChild>
          {/* Icon-only to sit in the header's share cluster beside Copy update
              and Report; the tooltip above carries the full description. */}
          <Button variant="ghost" size="icon-sm">
            <RiMailSendLine className="size-3.5" />
          </Button>
        </DialogTrigger>
      </Tip>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Email progress of “{entityName}”</DialogTitle>
          <DialogDescription>
            Recipients get your message at the top, followed by an auto-generated progress view with an
            “Open in Flux” link and the full Excel report attached. Check the Preview tab to see the exact email
            before sending.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
          <TabsList>
            <TabsTrigger value="compose">Compose</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            {schedulesEndpoint && (
              <TabsTrigger value="schedule">
                Repeat
                {schedules.some((row) => !row.pausedAt && !row.stoppedAt) && (
                  <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400">●</span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="compose" className="mt-3 outline-none">
        <div className="space-y-3">
          {projectId && stakeholders.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Project stakeholders</Label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {stakeholders.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={checked.has(s.email.toLowerCase())} onCheckedChange={() => toggle(s.email)} />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">{s.email}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              Add people — anyone in the system by name, or any email
            </Label>
            {extraRecipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                {extraRecipients.map((p) => (
                  <span
                    key={p.email}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">{p.email}</span>
                    <button
                      type="button"
                      onClick={() => setExtraRecipients((cur) => cur.filter((x) => x.email !== p.email))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <RiCloseLine className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Input
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
                onKeyDown={handlePersonKeyDown}
                placeholder="Type a name (e.g. Rohit) or an email, Enter to add"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
                  {suggestions.map((p) => (
                    <button
                      key={p.email}
                      type="button"
                      onClick={() => addPerson(p)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">{p.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => {
                subjectUntouched.current = false;
                setSubject(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Message — appears at the top of the email</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="text-xs" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Included automatically, always live: phase badge · stat tiles · progress bars · breakdown table with Jira
            links · an “Open in Flux” button · the detailed Excel report as attachment. See the Preview tab for the
            exact email.
          </p>
        </div>
          </TabsContent>
          <TabsContent value="preview" className="mt-3 outline-none">
            {previewLoading ? (
              <div className="flex h-96 items-center justify-center text-xs text-muted-foreground">
                Rendering the exact email…
              </div>
            ) : preview ? (
              <div className="space-y-2">
                <p className="text-xs">
                  <span className="text-muted-foreground">Subject: </span>
                  <span className="font-medium">{preview.subject}</span>
                </p>
                {/* Rendered by the same server code that sends — this IS the email. */}
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-96 w-full rounded-md border border-border bg-white"
                />
                <p className="text-[11px] text-muted-foreground">
                  Exactly what recipients see, plus the Excel report attached. Edit on the Compose tab and come back —
                  the preview re-renders with your changes.
                </p>
              </div>
            ) : (
              <div className="flex h-96 items-center justify-center text-xs text-muted-foreground">
                Preview unavailable — switch back to Compose and try again.
              </div>
            )}
          </TabsContent>
          {schedulesEndpoint && (
            <TabsContent value="schedule" className="mt-3 space-y-4 outline-none">
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">How often</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={frequency}
                      onValueChange={(value) => setFrequency(value as ScheduleFrequency)}
                    >
                      <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHEDULE_FREQUENCY_VALUES.map((value) => (
                          <SelectItem key={value} value={value} className="text-xs">
                            {value === "daily" ? "Daily" : value === "weekly" ? "Weekly" : "Monthly"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {frequency === "weekly" && (
                      <Select
                        value={String(dayOfWeek)}
                        onValueChange={(value) => setDayOfWeek(Number(value))}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAY_LABELS.map((label, index) => (
                            <SelectItem key={label} value={String(index)} className="text-xs">
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {frequency === "monthly" && (
                      <Select
                        value={String(dayOfMonth)}
                        onValueChange={(value) => setDayOfMonth(Number(value))}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                            <SelectItem key={day} value={String(day)} className="text-xs">
                              {ordinal(day)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Stop after this date — optional
                  </Label>
                  <Input
                    type="date"
                    value={endsOn}
                    min={istToday()}
                    onChange={(e) => setEndsOn(e.target.value)}
                    className="h-8 w-[170px] text-xs"
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {"ended" in firstSend ? (
                    <span className="text-destructive">
                      That end date lands before the first send — pick a later one.
                    </span>
                  ) : (
                    <>
                      {describeCadence(cadence)}, IST. First send{" "}
                      <span className="font-medium text-foreground">{firstSend.nextRunOn}</span>. Uses
                      the recipients, subject and message from the Compose tab, but the progress
                      figures and the attached report are rebuilt from live data on every send.
                    </>
                  )}
                </p>
                {recipients.length === 0 && (
                  <p className="text-[11px] text-destructive">
                    Pick recipients on the Compose tab first.
                  </p>
                )}

                <Button size="sm" disabled={!canSchedule} onClick={handleSchedule}>
                  <RiRepeat2Line className="size-3.5" />
                  {scheduling ? "Scheduling…" : "Schedule it"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] text-muted-foreground">
                  Scheduled for this sprint
                </Label>
                <ScheduleList
                  schedules={schedules}
                  onChanged={loadSchedules}
                  emptyLabel="Nothing scheduled yet — set a cadence above and this update will go out on its own."
                />
                <p className="text-[11px] text-muted-foreground">
                  Scheduled updates go out at midnight IST. When the sprint closes, one final
                  wrap-up is sent and the schedule stops on its own.
                </p>
              </div>
            </TabsContent>
          )}
        </Tabs>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {/* The Repeat tab has its own "Schedule it" button, so the one-off
              Send is hidden there rather than sitting next to it inviting a
              double action. */}
          {tab !== "schedule" && (
            <Button
              size="sm"
              disabled={recipients.length === 0 || !subject.trim() || !message.trim() || sending}
              onClick={handleSend}
            >
              <RiMailSendLine className="size-3.5" />
              {sending
                ? "Sending…"
                : `Send to ${recipients.length || "…"} recipient${recipients.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
