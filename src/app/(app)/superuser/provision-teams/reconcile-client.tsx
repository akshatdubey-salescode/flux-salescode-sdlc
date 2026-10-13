"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiRefreshLine,
  RiSearchLine,
  RiUserAddLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ReconcileBoard, ReconcileProposal } from "@/lib/observer/reconcile";
import {
  commitReconcile,
  dryRunReconcile,
  getReconcileForManager,
  getReconcileProposal,
  type DryRunResult,
  type SyncResult,
} from "./actions";

type BoardSel = Record<string, boolean>;

export function ReconcileTeamsClient({ initial }: { initial: ReconcileProposal }) {
  const router = useRouter();
  const [proposal, setProposal] = useState<ReconcileProposal>(initial);
  const [sel, setSel] = useState<Record<string, BoardSel>>(() =>
    Object.fromEntries(
      initial.boards.map((b) => [
        b.boardId,
        Object.fromEntries(b.missing.map((m) => [m.email, true])),
      ]),
    ),
  );
  const [search, setSearch] = useState("");
  const [managerQuery, setManagerQuery] = useState("");
  const [single, setSingle] = useState<ReconcileBoard | null | "none">(null);
  const [isSyncing, startSync] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isLookingUp, startLookup] = useTransition();
  const [isDryRunning, startDryRun] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [dryRunKey, setDryRunKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const visible = proposal.boards.filter((b) => {
    if (!q) return true;
    return (
      b.managerName.toLowerCase().includes(q) ||
      b.managerEmail.toLowerCase().includes(q) ||
      b.boardName.toLowerCase().includes(q)
    );
  });

  const selection = proposal.boards
    .map((b) => ({
      boardId: b.boardId,
      memberEmails: b.missing
        .filter((m) => sel[b.boardId]?.[m.email])
        .map((m) => m.email),
    }))
    .filter((b) => b.memberEmails.length > 0);

  const selectionKey = JSON.stringify(selection);
  const dryRunStale = dryRun?.ok && dryRunKey !== null && dryRunKey !== selectionKey;

  const selectedMembers = selection.reduce((n, b) => n + b.memberEmails.length, 0);

  function toggleMember(boardId: string, email: string, on: boolean) {
    setSel((prev) => ({
      ...prev,
      [boardId]: { ...prev[boardId], [email]: on },
    }));
  }

  function handleRefresh() {
    startRefresh(async () => {
      const r = await getReconcileProposal();
      if (r.ok) {
        setProposal(r.proposal);
        setSel(
          Object.fromEntries(
            r.proposal.boards.map((b) => [
              b.boardId,
              Object.fromEntries(b.missing.map((m) => [m.email, true])),
            ]),
          ),
        );
        setError(null);
        setDryRun(null);
        setDryRunKey(null);
      } else {
        setError(r.error);
      }
      router.refresh();
    });
  }

  function handleLookup() {
    if (!managerQuery.trim()) return;
    startLookup(async () => {
      const r = await getReconcileForManager(managerQuery.trim());
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSingle(r.board ?? "none");
      setError(null);
      const found = r.board;
      if (found) {
        const board = found;
        setSel((prev) => ({
          ...prev,
          [board.boardId]: Object.fromEntries(
            board.missing.map((m) => [m.email, true]),
          ),
        }));
        // The lookup board may be absent from the bulk proposal snapshot
        // (stale page). Merge it so selection, dry run, and sync cover it.
        setProposal((prev) =>
          prev.boards.some((b) => b.boardId === board.boardId)
            ? prev
            : {
                boards: [...prev.boards, board],
                totalBoards: prev.totalBoards + 1,
                totalMissing: prev.totalMissing + board.missing.length,
              },
        );
      }
    });
  }

  function handleDryRun() {
    startDryRun(async () => {
      const r = await dryRunReconcile(selection);
      setDryRun(r);
      if (r.ok) setDryRunKey(selectionKey);
      if (!r.ok) setError(r.error);
      else setError(null);
    });
  }

  function handleSync() {
    startSync(async () => {
      const r = await commitReconcile(selection);
      setResult(r);
      setDryRun(null);
      setDryRunKey(null);
      if (r.ok) {
        const fresh = await getReconcileProposal();
        if (fresh.ok) setProposal(fresh.proposal);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Sync existing teams
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Add-only. New Keka direct reports join their manager board. Nothing is
          removed. Manual members stay. Reads the last{" "}
          <Link href="/superuser/keka" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
            Keka sync
          </Link>
          .
        </p>
      </div>

      {/* Single-manager lookup */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Fix one manager
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={managerQuery}
            onChange={(e) => setManagerQuery(e.target.value)}
            placeholder="manager email, e.g. himanshu.rawat@salescode.ai"
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
          <Button variant="outline" onClick={handleLookup} disabled={isLookingUp || !managerQuery.trim()} className="gap-2 shrink-0">
            <RiSearchLine className="size-4" />
            {isLookingUp ? "Checking…" : "Check"}
          </Button>
        </div>
        {single === "none" && (
          <p className="mt-2 text-sm text-zinc-500">
            No fix applies. The manager has no board or no missing reports.
          </p>
        )}
        {single && single !== "none" && (
          <div className="mt-3 rounded-lg border border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {single.managerName} · {single.missing.length} missing
            </span>
            <span className="block text-xs text-zinc-500">
              {single.boardName} · {single.memberCount} members now, {single.reportCount} reports in Keka
            </span>
            <ul className="mt-2 space-y-1">
              {single.missing.map((m) => (
                <li key={m.email} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sel[single.boardId]?.[m.email] ?? false}
                    onCheckedChange={(v) => toggleMember(single.boardId, m.email, v === true)}
                    aria-label={`Include ${m.name}`}
                  />
                  <span className="text-zinc-800 dark:text-zinc-200">{m.name}</span>
                  <span className="text-xs text-zinc-500">{m.email}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Bulk summary + actions */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {proposal.totalBoards}
          </span>{" "}
          boards need members ·{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {selectedMembers}
          </span>{" "}
          selected
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="gap-2">
            <RiRefreshLine className={cn("size-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="outline" onClick={handleDryRun} disabled={isDryRunning || selection.length === 0} className="gap-2">
            <RiEyeLine className="size-4" />
            {isDryRunning ? "Previewing…" : "Dry run"}
          </Button>
          <Button onClick={handleSync} disabled={isSyncing || selection.length === 0} className="gap-2">
            <RiUserAddLine className="size-4" />
            {isSyncing ? "Syncing…" : `Add ${selectedMembers} member${selectedMembers === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      {dryRun && dryRun.ok && (
        <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
          <p className="flex items-center gap-2 font-medium">
            <RiEyeLine className="size-4 shrink-0" />
            Dry run — nothing written. Would add {dryRun.totalWouldAdd} member{dryRun.totalWouldAdd === 1 ? "" : "s"} across {dryRun.totalBoards} board{dryRun.totalBoards === 1 ? "" : "s"}
            {dryRun.totalSkipped > 0 && ` · ${dryRun.totalSkipped} skipped`}
            {dryRunStale && " · selection changed since preview, re-run to refresh"}
            .
          </p>
          {dryRun.boards.map((b) => (
            <div key={b.boardId} className="text-[13px]">
              <span className="font-medium">
                {b.managerName || b.boardName}:
              </span>{" "}
              {b.wouldAdd.length > 0 ? (
                <span>{b.wouldAdd.map((m) => `${m.name} (${m.email})`).join(", ")}</span>
              ) : (
                <span>nothing to add</span>
              )}
              {b.skipped.length > 0 && (
                <span className="block text-xs opacity-80">
                  Skipped ({b.skipped.map((s) => `${s.email}: ${s.reason}`).join(", ")})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {result?.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
          <RiCheckLine className="size-4 shrink-0" />
          Added {result.membersAdded} member{result.membersAdded === 1 ? "" : "s"} across {result.boardsTouched} board{result.boardsTouched === 1 ? "" : "s"}. Nothing removed.
        </div>
      )}
      {result && !result.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
          <span className="font-mono text-xs break-all">{result.error}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
          <span className="font-mono text-xs break-all">{error}</span>
        </div>
      )}

      {proposal.boards.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <RiCheckLine className="size-4 text-emerald-500" />
          Every board already includes all Keka direct reports.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <RiSearchLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search manager, email, board…"
              className="pl-9"
            />
          </div>
          {visible.map((b) => (
            <div key={b.boardId} className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {b.managerName} · {b.missing.length} missing
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {b.boardName} · {b.memberCount} members now, {b.reportCount} reports in Keka
                  </span>
                </div>
                <Link href={`/observer/${b.boardId}`}>
                  <Badge variant="secondary" className="shrink-0 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                    View team →
                  </Badge>
                </Link>
              </div>
              <ul className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800 divide-y divide-zinc-50 dark:divide-zinc-800/50">
                {b.missing.map((m) => (
                  <li key={m.email} className="flex items-center gap-3 py-2">
                    <Checkbox
                      checked={sel[b.boardId]?.[m.email] ?? false}
                      onCheckedChange={(v) => toggleMember(b.boardId, m.email, v === true)}
                      aria-label={`Include ${m.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-zinc-800 dark:text-zinc-200">
                        {m.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{m.email}</span>
                    </div>
                    {!m.isFluxUser && (
                      <Badge variant="outline" className="shrink-0 text-[10px] text-zinc-400">
                        not a Flux user
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
