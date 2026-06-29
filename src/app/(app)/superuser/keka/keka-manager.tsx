"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiRefreshLine,
  RiUserAddLine,
} from "@remixicon/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  assignKekaEmployee,
  syncKekaNow,
  syncKekaAttendanceNow,
  syncKekaLeaveNow,
  type KekaSyncResult,
  type KekaAttendanceSyncResult,
  type KekaLeaveSyncResult,
} from "./actions";

export type KekaEmployeeRow = {
  kekaEmployeeId: string;
  employeeNumber: string | null;
  displayName: string | null;
  email: string | null;
  jobTitle: string | null;
  managerName: string | null;
  employmentStatusLabel: string | null;
};

export type UserOption = { id: string; email: string };

export function KekaManager({
  counts,
  lastSynced,
  unlinked,
  users,
}: {
  counts: { total: number; linked: number; unlinked: number };
  lastSynced: string | null;
  unlinked: KekaEmployeeRow[];
  users: UserOption[];
}) {
  const router = useRouter();
  const [isSyncing, startSync] = useTransition();
  const [result, setResult] = useState<KekaSyncResult | null>(null);
  const [isSyncingAtt, startSyncAtt] = useTransition();
  const [attResult, setAttResult] = useState<KekaAttendanceSyncResult | null>(null);
  const [isSyncingLeave, startSyncLeave] = useTransition();
  const [leaveResult, setLeaveResult] = useState<KekaLeaveSyncResult | null>(null);

  function handleSync() {
    startSync(async () => {
      const r = await syncKekaNow();
      setResult(r);
      router.refresh();
    });
  }

  function handleSyncAttendance() {
    startSyncAtt(async () => {
      const r = await syncKekaAttendanceNow();
      setAttResult(r);
      router.refresh();
    });
  }

  function handleSyncLeave() {
    startSyncLeave(async () => {
      const r = await syncKekaLeaveNow();
      setLeaveResult(r);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Sync */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-zinc-500">
              Pull the latest employee directory from Keka. Idempotent — safe to
              re-run. Refreshes automatically via the daily keka-sync cron.
            </p>
            <LastSynced iso={lastSynced} />
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={handleSyncLeave}
              disabled={isSyncingLeave}
              className="gap-2"
            >
              <RiRefreshLine className={cn("size-4", isSyncingLeave && "animate-spin")} />
              {isSyncingLeave ? "Syncing…" : "Sync leave"}
            </Button>
            <Button
              variant="outline"
              onClick={handleSyncAttendance}
              disabled={isSyncingAtt}
              className="gap-2"
            >
              <RiRefreshLine className={cn("size-4", isSyncingAtt && "animate-spin")} />
              {isSyncingAtt ? "Syncing…" : "Sync attendance"}
            </Button>
            <Button onClick={handleSync} disabled={isSyncing} className="gap-2">
              <RiRefreshLine className={cn("size-4", isSyncing && "animate-spin")} />
              {isSyncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </div>

        {result?.ok && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
            <RiCheckLine className="size-4 shrink-0" />
            Synced {result.synced.toLocaleString()} active employees · linked{" "}
            {result.resolved.toLocaleString()} new by email · pruned{" "}
            {result.pruned.toLocaleString()} inactive · {result.errors} error
            {result.errors === 1 ? "" : "s"}.
          </div>
        )}
        {result && !result.ok && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
            <span className="font-mono text-xs break-all">{result.error}</span>
          </div>
        )}

        {attResult?.ok && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
            <RiCheckLine className="size-4 shrink-0" />
            Attendance {attResult.from} → {attResult.to}: synced{" "}
            {attResult.synced.toLocaleString()} day-records · skipped{" "}
            {attResult.skipped.toLocaleString()} · {attResult.errors} error
            {attResult.errors === 1 ? "" : "s"}.
          </div>
        )}
        {attResult && !attResult.ok && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
            <span className="font-mono text-xs break-all">{attResult.error}</span>
          </div>
        )}

        {leaveResult?.ok && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
            <RiCheckLine className="size-4 shrink-0" />
            Leave {leaveResult.from} → {leaveResult.to}: synced{" "}
            {leaveResult.synced.toLocaleString()} requests · skipped{" "}
            {leaveResult.skipped.toLocaleString()} · {leaveResult.errors} error
            {leaveResult.errors === 1 ? "" : "s"}.
          </div>
        )}
        {leaveResult && !leaveResult.ok && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
            <span className="font-mono text-xs break-all">{leaveResult.error}</span>
          </div>
        )}
      </div>

      {/* Summary */}
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Employees" value={counts.total} />
        <Stat label="Linked to users" value={counts.linked} />
        <Stat label="Unlinked" value={counts.unlinked} />
      </dl>

      {/* Unlinked → manual map */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Unlinked employees
        </h2>
        <p className="text-xs text-zinc-500 mt-1 mb-3">
          Employees whose Keka work email didn&apos;t match an app user. Map them
          to a person manually. Most Keka employees won&apos;t have a Flux account
          — that&apos;s expected.
        </p>
        {unlinked.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <RiCheckLine className="size-4 text-emerald-500" />
            No unlinked employees.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {unlinked.map((e) => (
              <EmployeeRow key={e.kekaEmployeeId} employee={e} users={users} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// SSR-safe "are we on the client" check (no setState-in-effect). Returns false
// on the server / during hydration, true once running in the browser.
const subscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}

// Relative time depends on Date.now(), so render it only on the client to avoid
// an SSR/hydration mismatch. The absolute timestamp lives in the tooltip.
function LastSynced({ iso }: { iso: string | null }) {
  const isClient = useIsClient();

  if (!iso) {
    return (
      <span className="text-xs text-zinc-400 dark:text-zinc-500">
        Never synced
      </span>
    );
  }
  return (
    <span
      className="text-xs text-zinc-400 dark:text-zinc-500"
      title={isClient ? new Date(iso).toLocaleString() : undefined}
    >
      Last synced {isClient ? timeAgo(iso) : "…"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function EmployeeRow({
  employee,
  users,
}: {
  employee: KekaEmployeeRow;
  users: UserOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const label =
    employee.displayName ?? employee.email ?? employee.employeeNumber ?? "Unknown";
  const initials = (employee.displayName ?? employee.email ?? "??")
    .slice(0, 2)
    .toUpperCase();
  const sub = [employee.email, employee.jobTitle].filter(Boolean).join(" · ");

  function assign(userId: string) {
    setOpen(false);
    startTransition(async () => {
      await assignKekaEmployee(employee.kekaEmployeeId, userId);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-3 px-5 py-3", isPending && "opacity-50")}>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <span className="truncate">{label}</span>
          {employee.employmentStatusLabel === "Relieved" && (
            <Badge variant="secondary" className="shrink-0">Relieved</Badge>
          )}
        </span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          {sub || "—"}
        </span>
        {employee.managerName && (
          <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
            Reports to {employee.managerName}
          </span>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={isPending}>
            <RiUserAddLine className="size-4" />
            Map to…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search people…" />
            <CommandList>
              <CommandEmpty>No matching user.</CommandEmpty>
              <CommandGroup>
                {users.map((u) => (
                  <CommandItem key={u.id} value={u.email} onSelect={() => assign(u.id)}>
                    {u.email}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
