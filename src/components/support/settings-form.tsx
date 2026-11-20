"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeOfDayPicker } from "./ist-datetime-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePersonSearch, type KnownPerson } from "@/hooks/use-person-search";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/support/time";
import { parseEmailChips, settingsErrorField, type SettingsField } from "@/lib/support/settings-form";
import { PRIORITIES, type OfficeHours, type PeriodMode, type Priority, type SlaTargets } from "@/lib/support/types";

/** SettingsInput as it travels over JSON (mirrors src/lib/support/store.ts). */
type Settings = {
  enabled: boolean;
  supportLabel: string;
  periodMode: PeriodMode;
  periodStart: string | null;
  toEmails: string[];
  ccEmails: string[];
  approverUserIds: string[];
  sharedBy: string;
  sla: SlaTargets;
  officeHours: OfficeHours;
};

/** SLA minutes are kept as strings while editing so a field can be cleared. */
type SlaDraft = Record<Priority, { responseMin: string; resolutionMin: string }>;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const PERIOD_LABELS: Record<PeriodMode, string> = {
  mtd: "Month to date (MTD)",
  ytd: "Year to date (YTD)",
  custom: "Custom start date",
};

function toSlaDraft(sla: SlaTargets): SlaDraft {
  const out = {} as SlaDraft;
  for (const p of PRIORITIES) {
    out[p] = { responseMin: String(sla[p].responseMin), resolutionMin: String(sla[p].resolutionMin) };
  }
  return out;
}

function fromSlaDraft(d: SlaDraft): SlaTargets {
  const out = {} as SlaTargets;
  for (const p of PRIORITIES) {
    // Non-numbers become NaN → JSON null → the server's "must be a positive integer".
    out[p] = { responseMin: Number(d[p].responseMin), resolutionMin: Number(d[p].resolutionMin) };
  }
  return out;
}

/** Key-order-independent comparison for the dirty check. */
function fingerprint(s: Settings): string {
  return JSON.stringify([
    s.enabled,
    s.supportLabel,
    s.sharedBy,
    s.periodMode,
    s.periodMode === "custom" ? s.periodStart : null,
    s.toEmails,
    s.ccEmails,
    s.approverUserIds,
    PRIORITIES.map((p) => [s.sla[p].responseMin, s.sla[p].resolutionMin]),
    [s.officeHours.start, s.officeHours.end, s.officeHours.days],
  ]);
}

/**
 * `requireRole` redirects (to /home) rather than answering 403, and fetch
 * follows the redirect to an HTML page — so a redirected or non-JSON response
 * is a failure, never a success.
 */
async function readJson<T>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string | null }> {
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.redirected || !isJson) return { ok: false, error: null };
  try {
    const body = (await res.json()) as T & { error?: unknown };
    if (!res.ok) return { ok: false, error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: null };
  }
}

function FieldError({ field, error }: { field: SettingsField; error: { field: SettingsField; message: string } | null }) {
  if (!error || error.field !== field) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {error.message}
    </p>
  );
}

function EmailChips({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const { added, invalid } = parseEmailChips(raw, value);
    if (added.length) onChange([...value, ...added]);
    setText(invalid.join(", "));
    if (invalid.length) toast.error(`Not an email: ${invalid.join(", ")}`);
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((email) => (
            <Badge key={email} variant="outline" className="gap-1 pr-1">
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => onChange(value.filter((e) => e !== email))}
                className="text-muted-foreground hover:text-foreground"
              >
                <RiCloseLine className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // A typed or pasted separator commits what came before it.
          if (/[,;]/.test(v)) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (text.trim()) commit(text);
          } else if (e.key === "Backspace" && text === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (text.trim()) commit(text);
        }}
      />
    </div>
  );
}

function ApproversPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { query, setQuery, suggestions, clear } = usePersonSearch();
  // Names for people picked this session; stored ids are emails only.
  const [names, setNames] = useState<Record<string, string>>({});

  function add(person: KnownPerson | string) {
    const email = (typeof person === "string" ? person : person.email).trim().toLowerCase();
    if (!email) return;
    if (typeof person !== "string") setNames((n) => ({ ...n, [email]: person.name }));
    if (!value.includes(email)) onChange([...value, email]);
    clear();
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="outline" className="gap-1 pr-1">
              {names[id] ? `${names[id]} · ${id}` : id}
              <button
                type="button"
                aria-label={`Remove approver ${id}`}
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="text-muted-foreground hover:text-foreground"
              >
                <RiCloseLine className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          id="support-approvers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (suggestions.length > 0) add(suggestions[0]);
            else if (parseEmailChips(query).added.length === 1) add(query);
          }}
          placeholder="Search by name or email, Enter to add"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((p) => (
              <button
                key={p.email}
                type="button"
                onClick={() => add(p)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">{p.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsForm({ projectId }: { projectId: string }) {
  const url = `/api/projects/${projectId}/support/settings`;
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [enabled, setEnabled] = useState(false);
  const [supportLabel, setSupportLabel] = useState("");
  const [sharedBy, setSharedBy] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("mtd");
  const [periodStart, setPeriodStart] = useState("");
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [sla, setSla] = useState<SlaDraft | null>(null);
  const [officeHours, setOfficeHours] = useState<OfficeHours | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: SettingsField; message: string } | null>(null);

  function apply(s: Settings) {
    setLoaded(s);
    setEnabled(s.enabled);
    setSupportLabel(s.supportLabel);
    setSharedBy(s.sharedBy);
    setPeriodMode(s.periodMode);
    setPeriodStart(s.periodStart ?? "");
    setToEmails(s.toEmails);
    setCcEmails(s.ccEmails);
    setApprovers(s.approverUserIds);
    setSla(toSlaDraft(s.sla));
    setOfficeHours(s.officeHours);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const r = await readJson<Settings>(res);
        if (!r.ok) throw new Error(r.error ?? "load failed");
        return r.data;
      })
      .then((s) => {
        if (cancelled) return;
        apply(s);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey]);

  if (loadError && !loaded) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-sm text-zinc-500">
        Couldn&apos;t load support report settings.
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!loaded || !sla || !officeHours) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const body: Settings = {
    enabled,
    supportLabel,
    sharedBy,
    periodMode,
    periodStart: periodMode === "custom" ? periodStart || null : null,
    toEmails,
    ccEmails,
    approverUserIds: approvers,
    sla: fromSlaDraft(sla),
    officeHours,
  };
  const dirty = fingerprint(body) !== fingerprint(loaded);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = await readJson<Settings>(res);
      if (!r.ok) {
        if (r.error === null) {
          const message = "You don't have permission to change settings";
          setError({ field: "form", message });
          toast.error(message);
        } else {
          setError({ field: settingsErrorField(r.error), message: r.error });
          toast.error("Settings not saved", { description: r.error });
        }
        return;
      }
      apply(r.data);
      toast.success("Support report settings saved");
    } catch {
      setError({ field: "form", message: "Couldn't save settings — check your connection and try again" });
    } finally {
      setSaving(false);
    }
  }

  function setSlaCell(p: Priority, key: "responseMin" | "resolutionMin", v: string) {
    setSla((cur) => (cur ? { ...cur, [p]: { ...cur[p], [key]: v } } : cur));
  }

  function toggleDay(d: number) {
    setOfficeHours((cur) => {
      if (!cur) return cur;
      const days = cur.days.includes(d) ? cur.days.filter((x) => x !== d) : [...cur.days, d].sort((a, b) => a - b);
      return { ...cur, days };
    });
  }

  function hoursHint(v: string): string | null {
    const n = Number(v);
    if (!v.trim() || !Number.isInteger(n) || n <= 0) return null;
    return n >= 60 ? formatDuration(n) : null;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Daily report</CardTitle>
          <CardDescription>
            Built at 17:00 IST from Jira issues carrying the external label, then held for approval before it is
            mailed to the client.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch id="support-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="support-enabled">Build the daily report for this project</Label>
          </div>
          <FieldError field="enabled" error={error} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="support-label">External label</Label>
              <Input
                id="support-label"
                value={supportLabel}
                onChange={(e) => setSupportLabel(e.target.value)}
                aria-invalid={error?.field === "supportLabel" || undefined}
              />
              <p className="text-xs text-muted-foreground">Jira label that marks a support ticket (case-insensitive).</p>
              <FieldError field="supportLabel" error={error} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support-shared-by">Shared by</Label>
              <Input
                id="support-shared-by"
                value={sharedBy}
                onChange={(e) => setSharedBy(e.target.value)}
                aria-invalid={error?.field === "sharedBy" || undefined}
              />
              <p className="text-xs text-muted-foreground">Shown as the sender line in the report.</p>
              <FieldError field="sharedBy" error={error} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-period">Period column</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={periodMode} onValueChange={(v) => setPeriodMode(v as PeriodMode)}>
                <SelectTrigger id="support-period" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABELS) as PeriodMode[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {PERIOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {periodMode === "custom" && (
                <Input
                  type="date"
                  aria-label="Period start date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-44"
                  aria-invalid={error?.field === "period" || undefined}
                />
              )}
            </div>
            <FieldError field="period" error={error} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipients and approvers</CardTitle>
          <CardDescription>
            The client mail goes to To and CC. Approvers (and admins) review and send it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="support-to">To</Label>
            <EmailChips id="support-to" value={toEmails} onChange={setToEmails} placeholder="Add emails, Enter or comma to add" />
            <FieldError field="toEmails" error={error} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-cc">CC</Label>
            <EmailChips id="support-cc" value={ccEmails} onChange={setCcEmails} placeholder="Add emails, Enter or comma to add" />
            <FieldError field="ccEmails" error={error} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-approvers">Approvers</Label>
            <ApproversPicker value={approvers} onChange={setApprovers} />
            <p className="text-xs text-muted-foreground">
              Notified when the report is built; any one of them can approve. Admins can always approve.
            </p>
            <FieldError field="approvers" error={error} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SLA targets</CardTitle>
          <CardDescription>Agreed response and resolution times per priority, in minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid max-w-xl grid-cols-[3rem_1fr_1fr] items-start gap-x-3 gap-y-2">
            <span />
            <span className="text-xs font-medium text-muted-foreground">Response (min)</span>
            <span className="text-xs font-medium text-muted-foreground">Resolution (min)</span>
            {PRIORITIES.map((p) => (
              <div key={p} className="contents">
                <span className="pt-1.5 text-sm font-medium">{p}</span>
                {(["responseMin", "resolutionMin"] as const).map((k) => {
                  const hint = hoursHint(sla[p][k]);
                  return (
                    <div key={k} className="space-y-0.5">
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        aria-label={`${p} ${k === "responseMin" ? "response" : "resolution"} minutes`}
                        value={sla[p][k]}
                        onChange={(e) => setSlaCell(p, k, e.target.value)}
                      />
                      <p className="h-4 text-[11px] text-muted-foreground">{hint ? `= ${hint}` : ""}</p>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <FieldError field="sla" error={error} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Office hours</CardTitle>
          <CardDescription>
            SLA time only counts Salescode-owned minutes inside these hours (IST).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Start (IST)</Label>
              <TimeOfDayPicker
                label="Office hours start"
                value={officeHours.start}
                onChange={(v) => setOfficeHours({ ...officeHours, start: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End (IST)</Label>
              <TimeOfDayPicker
                label="Office hours end"
                value={officeHours.end}
                allowEndOfDay
                onChange={(v) => setOfficeHours({ ...officeHours, end: v })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Working days</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
              {DAY_LABELS.map((label, d) => {
                const on = officeHours.days.includes(d);
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => toggleDay(d)}
                    className="w-12"
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          <FieldError field="officeHours" error={error} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {dirty && !saving && (
          <Button variant="ghost" onClick={() => apply(loaded)}>
            Discard changes
          </Button>
        )}
        <span className={cn("text-xs", error?.field === "form" ? "text-destructive" : "text-muted-foreground")}>
          {error?.field === "form" ? error.message : error ? "Fix the highlighted field and save again." : ""}
        </span>
      </div>
    </div>
  );
}
