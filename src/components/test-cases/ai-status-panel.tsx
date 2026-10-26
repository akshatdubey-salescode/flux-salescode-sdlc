"use client";

import { useCallback, useEffect, useState } from "react";
import { RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = {
  configured: boolean;
  state: "ok" | "degraded" | "paused";
  reason: "quota" | "auth" | "rate_limited" | "unavailable" | null;
  message: string | null;
  since: string | null;
  lastOkAt: string | null;
  lastFailureAt: string | null;
  retryAt: string | null;
  usage: { runs: number; inputTokens: number; outputTokens: number };
  needingReview: number;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "never";
const num = (n: number) => n.toLocaleString("en-IN");

const REASON: Record<string, string> = {
  quota: "Quota or balance used up",
  auth: "API key rejected",
  rate_limited: "Rate limited repeatedly",
  unavailable: "Service not answering",
};

/** Admin view of the AI service: whether it is usable, recent usage, and the two actions that matter when it isn't. */
export function AiStatusPanel() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"check" | "rerun" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/test-cases/ai-status", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Could not load the AI status.");
    else setS(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "check" | "rerun") {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/test-cases/ai-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "That didn't work.");
      else if (action === "check") {
        setS(data);
        setNote(data.state === "ok" ? "The AI service answered." : "The AI service is still not usable.");
      } else {
        setNote(`Started ${data.queued} review${data.queued === 1 ? "" : "s"}. They run in the background; refresh in a minute.`);
        setTimeout(() => void load(), 4000);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!s) return error ? <p className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">Loading status…</p>;

  const tone =
    !s.configured ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
    : s.state === "ok" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"
    : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30";
  const label = !s.configured ? "Not switched on (no API key)" : s.state === "ok" ? "Working" : s.state === "paused" ? "On hold" : "Having trouble";

  return (
    <section className={cn("space-y-2 rounded-lg border p-3 text-xs", tone)} aria-label="AI service status">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">AI service</h2>
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-black/30">{label}</span>
        {s.configured && (
          <div className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => act("check")} disabled={busy !== null}>
              {busy === "check" && <RiLoader4Line className="size-3.5 animate-spin" />}
              Check now
            </Button>
            {s.needingReview > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => act("rerun")} disabled={busy !== null || s.state === "paused"} title={s.state === "paused" ? "Press Check now first; re-run once the service answers." : undefined}>
                {busy === "rerun" && <RiLoader4Line className="size-3.5 animate-spin" />}
                Re-run {s.needingReview} skipped review{s.needingReview === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        )}
      </div>
      {s.state !== "ok" && s.configured && (
        <p className="text-amber-900 dark:text-amber-200">
          {s.message ?? (s.reason ? `${REASON[s.reason]}.` : "")}
          {s.state === "paused" && " Automatic reviews are being skipped; people can still review and approve."}
          {s.state === "paused" && s.retryAt && ` The next automatic review will try again after ${fmt(s.retryAt)}.`}
        </p>
      )}
      <p className="text-muted-foreground">
        Last answered {fmt(s.lastOkAt)}
        {s.lastFailureAt ? ` · last problem ${fmt(s.lastFailureAt)}` : ""} · last 24 hours: {s.usage.runs} review run{s.usage.runs === 1 ? "" : "s"}, {num(s.usage.inputTokens)} tokens in,{" "}
        {num(s.usage.outputTokens)} out.
      </p>
      {s.configured && s.state === "paused" && s.reason === "quota" && (
        <p className="text-muted-foreground">Top up or renew the plan in the MiniMax console, then press Check now.</p>
      )}
      {s.configured && s.state === "paused" && s.reason === "auth" && <p className="text-muted-foreground">Check MINIMAX_API_KEY in the environment settings, then press Check now.</p>}
      {note && <p className="text-emerald-700 dark:text-emerald-400">{note}</p>}
      {error && <p className="text-destructive">{error}</p>}
    </section>
  );
}
