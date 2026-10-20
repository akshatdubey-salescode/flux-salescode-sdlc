import {
  RiChat3Line,
  RiCheckboxCircleLine,
  RiFileUploadLine,
  RiShieldCheckLine,
  RiSkipForwardLine,
  RiErrorWarningLine,
  RiCheckLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { istDateTime } from "@/lib/test-cases/filenames";
import type { HistoryEvent, HistoryKind } from "@/lib/test-cases/history";

const ICON: Record<HistoryKind, { Icon: typeof RiChat3Line; cls: string }> = {
  submitted: { Icon: RiFileUploadLine, cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  approved: { Icon: RiCheckboxCircleLine, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  changes_requested: { Icon: RiErrorWarningLine, cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  comment: { Icon: RiChat3Line, cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  resolved: { Icon: RiCheckLine, cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  override: { Icon: RiSkipForwardLine, cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  signoff: { Icon: RiShieldCheckLine, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

/**
 * Everything that happened to this item's test cases, across every round and
 * every reviewer, for anyone who can open the page. Newest first.
 */
export function HistoryPanel({ events }: { events: HistoryEvent[] }) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Review history</h2>
        <p className="text-[11px] text-muted-foreground">Every submission, decision, comment, override and sign-off, across all rounds.</p>
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {events.map((e) => {
            const { Icon, cls } = ICON[e.kind];
            return (
              <li key={e.id} className="flex gap-2.5">
                <span className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full", cls)}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="font-semibold text-foreground">{e.actor}</span>
                    <span className="text-foreground">{e.title.charAt(0).toLowerCase() + e.title.slice(1)}</span>
                    {e.caseCode && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {e.tab ? `${e.tab} · ` : ""}
                        {e.caseCode}
                      </span>
                    )}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Round {e.roundNo}</span>
                    {e.source === "llm" && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">LLM</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{istDateTime(new Date(e.at))}</span>
                  </p>
                  {e.detail && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
