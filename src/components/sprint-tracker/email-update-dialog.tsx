"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiMailSendLine } from "@remixicon/react";
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
import type { SprintWithItems } from "@/lib/sprints/entries";
import { Tip } from "./tip";

type Stakeholder = { id: string; name: string; email: string };
type KnownPerson = { email: string; name: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * Manual "send progress to stakeholders" for a sprint or a workstream:
 * recipients from the project's stakeholder list plus anyone known to the
 * system (typeahead over the same org-wide directory the Team Pulse member
 * picker uses) or a raw email; the subject and top message are prefilled and
 * editable; the auto-generated progress view + Excel report ride along.
 */
export function EmailUpdateDialog({
  endpoint,
  projectId,
  entityName,
  buildDefaults,
}: {
  /** POST target: /api/sprints/[id]/email or /api/workstreams/[id]/email. */
  endpoint: string;
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
  const [personQuery, setPersonQuery] = useState("");
  const [suggestions, setSuggestions] = useState<KnownPerson[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"compose" | "preview">("compose");
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prefill the editable content when the dialog opens, from live data.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const defaults = buildDefaults();
      setSubject(defaults.subject);
      setMessage(defaults.message);
      setTab("compose");
      setPreview(null);
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
    setTab(value as "compose" | "preview");
    if (value === "preview") void loadPreview();
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

  // Typeahead over everyone the system knows (Keka directory + Jira
  // assignees/reporters + board members) — the same source the Team Pulse
  // member picker searches.
  function onPersonQueryChange(value: string) {
    setPersonQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/observer/developers?q=${encodeURIComponent(q)}&limit=8`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const rows = (await res.json()) as { email: string; name: string }[];
        setSuggestions(rows.map((r) => ({ email: r.email, name: r.name })));
      } catch {
        setSuggestions([]);
      }
    }, 250);
  }

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
    setPersonQuery("");
    setSuggestions([]);
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
      setPersonQuery("");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tip label={`Email the progress of ${entityName} to stakeholders — summary inline, detailed Excel report attached`}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-[11px]">
            <RiMailSendLine className="size-3.5" /> Email update
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
                onChange={(e) => onPersonQueryChange(e.target.value)}
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
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
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
        </Tabs>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
