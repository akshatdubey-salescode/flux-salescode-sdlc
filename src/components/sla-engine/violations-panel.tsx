"use client";

import { useState } from "react";
import { RiCheckLine, RiShieldLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatThreshold, formatRelativeTime } from "./helpers";
import type { SlaViolation } from "./index";

type Props = {
  violations: SlaViolation[];
  loading: boolean;
  onDismiss: (id: string) => Promise<void>;
};

export function ViolationsPanel({ violations, loading, onDismiss }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
          />
        ))}
      </div>
    );
  }

  if (violations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
        <RiShieldLine className="mx-auto mb-3 size-8 text-zinc-300 dark:text-zinc-600" />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No open violations
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          All issues are currently within SLA thresholds.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <th className="px-4 py-2.5 text-left font-medium text-zinc-500">
              Issue
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-zinc-500">
              Rule
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-zinc-500">
              Exceeded by
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-zinc-500">
              Violated
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-zinc-500">
              Notification
            </th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {violations.map((v) => (
            <ViolationRow key={v.id} violation={v} onDismiss={onDismiss} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViolationRow({
  violation: v,
  onDismiss,
}: {
  violation: SlaViolation;
  onDismiss: (id: string) => Promise<void>;
}) {
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    try {
      await onDismiss(v.id);
    } finally {
      setDismissing(false);
    }
  }

  const exceededHours =
    parseFloat(v.actualHours) - parseFloat(v.thresholdHoursSnapshot);

  return (
    <tr className="bg-white transition-colors hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
      <td className="px-4 py-3">
        <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
          {v.issueKey}
        </span>
        <p className="mt-0.5 max-w-xs truncate text-zinc-400">
          {v.issueSummary}
        </p>
      </td>
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
        {v.ruleName}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400">
          +{formatThreshold(exceededHours)}
        </span>
      </td>
      <td className="px-4 py-3 text-zinc-500">
        {formatRelativeTime(v.violatedAt)}
      </td>
      <td className="px-4 py-3">
        <NotificationPill status={v.notificationStatus} />
      </td>
      <td className="px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={dismissing}
          title="Mark as resolved"
        >
          <RiCheckLine />
          {dismissing ? "Dismissing…" : "Dismiss"}
        </Button>
      </td>
    </tr>
  );
}

function NotificationPill({ status }: { status: string | null }) {
  if (!status || status === "pending") {
    return <span className="text-zinc-400">Pending</span>;
  }
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
        <RiCheckLine className="size-2.5" />
        Sent
      </span>
    );
  }
  return (
    <span className={cn(
      "rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600",
      "dark:bg-red-900/20 dark:text-red-400"
    )}>
      Failed
    </span>
  );
}
