"use client";

import Link from "next/link";
import { RiCheckboxBlankCircleLine, RiCheckboxCircleFill, RiFlaskLine } from "@remixicon/react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { READINESS_LABELS } from "@/lib/test-cases/analytics";
import type { TcSummary } from "@/lib/test-cases/summary";
import { NO_TCS, useTcSummary } from "./tc-summary-cache";

const READINESS_CHIP: Record<TcSummary["readiness"], string> = {
  not_started: "text-muted-foreground",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  not_recommended: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  risk: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
};

function Row({ done, children, note }: { done: boolean; children: React.ReactNode; note?: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {done ? <RiCheckboxCircleFill className="size-3.5 shrink-0 text-emerald-600" /> : <RiCheckboxBlankCircleLine className="size-3.5 shrink-0 text-zinc-400" />}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{children}</span>
      {note && <span className="text-muted-foreground">({note})</span>}
    </li>
  );
}

/**
 * Test-case status for a Sprint / Delivery row: confidence % coloured by
 * readiness, with a hover card of the details. Renders nothing while loading
 * or when Test Cases is off, so call sites can drop it in unconditionally
 * (same contract as RcaBadge / DeliveryBadge).
 */
export function TcBadge({ issueId }: { issueId: string }) {
  const entry = useTcSummary(issueId);
  if (entry == null) return null;

  // Rows are clickable in places; the chip's own link must not also trigger the row.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (entry === NO_TCS || !("setId" in entry)) {
    return (
      <HoverCard>
        <HoverCardTrigger asChild>
          <Link
            href={`/test-cases/new?issue=${issueId}`}
            onClick={stop}
            aria-label="No test cases yet. Submit test cases"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            <RiFlaskLine className="size-3.5" />
          </Link>
        </HoverCardTrigger>
        <HoverCardContent className="w-56">
          <p className="font-semibold text-foreground">No test cases yet</p>
          <p className="mt-1 text-muted-foreground">Click to submit a Google Sheet or Excel of test cases for review.</p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  const s = entry;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Link
          href={`/test-cases/${issueId}`}
          onClick={stop}
          aria-label={`Test cases: ${s.confidence}% delivery confidence, ${READINESS_LABELS[s.readiness]}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold tabular-nums transition-opacity hover:opacity-80",
            READINESS_CHIP[s.readiness],
          )}
        >
          <RiFlaskLine className="size-3" />
          {s.confidence}%
        </Link>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-foreground">
            {s.tcCount} test cases · Round {s.roundNo}
          </p>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", READINESS_CHIP[s.readiness])}>{READINESS_LABELS[s.readiness]}</span>
        </div>

        <ul className="space-y-1">
          <Row done>{s.tcCount} test cases uploaded</Row>
          <Row done={s.llmReviewed} note={s.llmReviewed ? undefined : "not enabled yet"}>LLM reviewed</Row>
          <Row done={s.reviewersApproved > 0}>Reviewer approved ({s.reviewersApproved}/{s.reviewersTotal})</Row>
          <Row done={s.devSigned}>Developer signed off</Row>
          <Row done={s.testerSigned}>Tester signed off</Row>
        </ul>

        <dl className="grid grid-cols-4 gap-1 text-center">
          {(
            [
              ["Passed", s.pass, "text-emerald-600"],
              ["Failed", s.fail, "text-red-600"],
              ["Blocked", s.blocked, "text-amber-600"],
              ["Not run", s.notRun, "text-muted-foreground"],
            ] as const
          ).map(([label, n, cls]) => (
            <div key={label} className="rounded-md bg-muted/50 py-1">
              <dd className={cn("text-sm font-semibold tabular-nums", cls)}>{n}</dd>
              <dt className="text-[10px] text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>

        <p className="text-muted-foreground">
          Executed {s.executedPct}% · Quality {s.quality} (est.) · Execution {s.executionScore} · Feedback {s.feedbackOpen} open of {s.feedbackTotal}
        </p>

        {s.byType.length > 0 && (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-0.5 font-medium">Type</th>
                <th className="py-0.5 text-right font-medium">Total</th>
                <th className="py-0.5 text-right font-medium">Pass</th>
                <th className="py-0.5 text-right font-medium">Fail</th>
                <th className="py-0.5 text-right font-medium">Blocked</th>
                <th className="py-0.5 text-right font-medium">Not run</th>
              </tr>
            </thead>
            <tbody>
              {s.byType.map((t) => (
                <tr key={t.key} className="border-t border-border/50 tabular-nums">
                  <td className="py-0.5">{t.label}</td>
                  <td className="py-0.5 text-right">{t.total}</td>
                  <td className="py-0.5 text-right text-emerald-600">{t.pass}</td>
                  <td className="py-0.5 text-right text-red-600">{t.fail}</td>
                  <td className="py-0.5 text-right text-amber-600">{t.blocked}</td>
                  <td className="py-0.5 text-right text-muted-foreground">{t.notRun}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-muted-foreground">Click for the full test cases page.</p>
      </HoverCardContent>
    </HoverCard>
  );
}
