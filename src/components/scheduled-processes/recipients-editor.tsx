"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePersonSearch, type KnownPerson } from "@/hooks/use-person-search";

/**
 * Add or remove people on a schedule that's already running, without touching
 * its cadence — the change people actually want most ("put Priya on the weekly
 * update"), and the reason the API has a recipients-only action.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RecipientsEditor({
  scheduleId,
  recipients,
  onSaved,
  onCancel,
}: {
  scheduleId: string;
  recipients: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(recipients);
  const [saving, setSaving] = useState(false);
  const { query, setQuery, suggestions, clear } = usePersonSearch();

  const dirty =
    draft.length !== recipients.length || draft.some((email) => !recipients.includes(email));

  function add(email: string) {
    const key = email.trim().toLowerCase();
    if (!key) return;
    if (draft.includes(key)) {
      toast.error(`${key} is already on this schedule`);
    } else {
      setDraft((cur) => [...cur, key]);
    }
    clear();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (suggestions.length > 0) {
      add(suggestions[0].email);
      return;
    }
    // Not in the system (an external client, say) — a raw address is fine.
    const raw = query.trim().toLowerCase();
    if (EMAIL_RE.test(raw)) add(raw);
  }

  async function save() {
    if (draft.length === 0) {
      toast.error("A schedule needs at least one recipient — delete it instead");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/scheduled-processes/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setRecipients", recipients: draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't update the recipients");
        return;
      }
      toast.success(
        `Recipients updated — ${draft.length} on this schedule from the next send`
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
      <div className="flex flex-wrap gap-1.5">
        {draft.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
          >
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={() => setDraft((cur) => cur.filter((e) => e !== email))}
              className="text-muted-foreground hover:text-foreground"
            >
              <RiCloseLine className="size-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a name or an email, Enter to add"
          className="h-7 text-[11px]"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((p: KnownPerson) => (
              <button
                key={p.email}
                type="button"
                onClick={() => add(p.email)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-muted"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">{p.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button size="sm" className="h-6 text-[11px]" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save recipients"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px]"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Applies from the next send — it doesn&apos;t change the cadence.
        </span>
      </div>
    </div>
  );
}
