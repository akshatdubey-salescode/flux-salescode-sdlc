"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiDeleteBin6Line, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MIN_DELETE_REASON } from "@/lib/test-cases/state";
import { invalidateTcSummaries } from "./tc-summary-cache";

/**
 * Admin-only escape hatch for a wrong sheet or link: removes every round, case,
 * review, sign-off and file of this item so it can be submitted afresh. The
 * server enforces the same rules; this only keeps the form honest.
 */
export function DeletePanel({
  issueId,
  issueKey,
  summary,
}: {
  issueId: string;
  issueKey: string;
  summary: { rounds: number; cases: number; signoffs: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = confirm.trim().toUpperCase() === issueKey.toUpperCase() && reason.trim().length >= MIN_DELETE_REASON && !busy;

  async function remove() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-cases/issues/${issueId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not delete.");
        return;
      }
      invalidateTcSummaries();
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-red-200 bg-red-50/40 p-4 dark:border-red-900/60 dark:bg-red-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Admin: delete all test cases for {issueKey}</h2>
          <p className="text-[11px] text-muted-foreground">
            Use when a wrong sheet or link was submitted. Removes {summary.rounds} round{summary.rounds === 1 ? "" : "s"}, {summary.cases} test case
            {summary.cases === 1 ? "" : "s"}, all reviews, feedback, {summary.signoffs} sign-off{summary.signoffs === 1 ? "" : "s"}, history and stored files. This can&apos;t be undone.
          </p>
        </div>
        {!open && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400">
            <RiDeleteBin6Line className="size-3.5" />
            Delete all test cases
          </Button>
        )}
      </div>

      {open && (
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={4000}
            placeholder="Why are they being deleted? (required)"
            aria-label="Reason for deleting the test cases"
            className="min-h-14 text-xs"
          />
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Type ${issueKey} to confirm`} className="max-w-xs text-xs" aria-label="Type the Jira key to confirm" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={remove} disabled={!ready} className="bg-red-600 text-white hover:bg-red-700">
              {busy && <RiLoader4Line className="size-3.5 animate-spin" />}
              Delete permanently
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>
              Cancel
            </Button>
            {error && <span className="text-[11px] text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
