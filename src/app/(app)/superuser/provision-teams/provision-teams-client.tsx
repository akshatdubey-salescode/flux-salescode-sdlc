"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiArrowGoBackLine,
  RiTeamLine,
  RiArrowDownSLine,
  RiSearchLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { ProposedBoard, ProvisionProposal } from "@/lib/observer/provisioning";
import {
  commitProvision,
  rollbackProvision,
  type CommitResult,
  type RollbackResult,
} from "./actions";

export type ProvisionRunRow = {
  id: string;
  triggeredBy: string;
  status: "active" | "rolled_back";
  boardsCreated: number;
  membersCreated: number;
  createdAt: string;
  rolledBackAt: string | null;
};

type BoardSel = {
  included: boolean;
  boardName: string;
  members: Record<string, boolean>;
};

// Sentinel for the "all departments" filter option (Radix Select disallows "").
const ALL_DEPTS = "__all__";
const NO_DEPT = "No department";
const deptLabel = (b: ProposedBoard) => b.department ?? NO_DEPT;

export function ProvisionTeamsClient({
  proposal,
  runs,
}: {
  proposal: ProvisionProposal;
  runs: ProvisionRunRow[];
}) {
  const router = useRouter();
  const [isCommitting, startCommit] = useTransition();
  const [result, setResult] = useState<CommitResult | null>(null);

  const [sel, setSel] = useState<Record<string, BoardSel>>(() => {
    const init: Record<string, BoardSel> = {};
    for (const b of proposal.boards) {
      if (b.skipped) continue;
      init[b.managerEmail] = {
        included: true,
        boardName: b.boardName,
        members: Object.fromEntries(b.members.map((m) => [m.email, true])),
      };
    }
    return init;
  });

  const [search, setSearch] = useState("");
  const [dept, setDept] = useState(ALL_DEPTS);

  const actionable = proposal.boards.filter((b) => !b.skipped);
  const skipped = proposal.boards.filter((b) => b.skipped);

  // Distinct departments across the whole proposal, for the filter dropdown.
  // (Plain consts — the React Compiler memoizes these automatically.)
  const departments = [...new Set(proposal.boards.map(deptLabel))].sort((a, b) =>
    a.localeCompare(b)
  );

  const q = search.trim().toLowerCase();
  const matches = (b: ProposedBoard) => {
    if (dept !== ALL_DEPTS && deptLabel(b) !== dept) return false;
    if (!q) return true;
    return (
      b.managerName.toLowerCase().includes(q) ||
      b.managerEmail.toLowerCase().includes(q) ||
      b.boardName.toLowerCase().includes(q) ||
      b.members.some(
        (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
      )
    );
  };

  const visibleActionable = actionable.filter(matches);
  const visibleSkipped = skipped.filter(matches);

  const selection = actionable
    .filter((b) => sel[b.managerEmail]?.included)
    .map((b) => ({
      managerEmail: b.managerEmail,
      boardName: sel[b.managerEmail].boardName,
      memberEmails: b.members
        .filter((m) => sel[b.managerEmail].members[m.email])
        .map((m) => m.email),
    }))
    .filter((b) => b.memberEmails.length > 0);

  const selectedMembers = selection.reduce((n, b) => n + b.memberEmails.length, 0);

  function setBoard(managerEmail: string, patch: Partial<BoardSel>) {
    setSel((prev) => ({ ...prev, [managerEmail]: { ...prev[managerEmail], ...patch } }));
  }

  // Include/exclude every board currently shown by the search/department filter
  // — the point of the filter is to act on one department (or search) at a time.
  function setAllShown(on: boolean) {
    setSel((prev) => {
      const next = { ...prev };
      for (const b of visibleActionable) {
        next[b.managerEmail] = { ...next[b.managerEmail], included: on };
      }
      return next;
    });
  }

  function toggleMember(managerEmail: string, email: string, on: boolean) {
    setSel((prev) => ({
      ...prev,
      [managerEmail]: {
        ...prev[managerEmail],
        members: { ...prev[managerEmail].members, [email]: on },
      },
    }));
  }

  function handleProvision() {
    startCommit(async () => {
      const r = await commitProvision(selection);
      setResult(r);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary + action */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {selection.length}
          </span>{" "}
          team{selection.length === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {selectedMembers}
          </span>{" "}
          member{selectedMembers === 1 ? "" : "s"} selected
          {skipped.length > 0 && (
            <>
              {" "}
              · <span className="text-zinc-400">{skipped.length} already have a team</span>
            </>
          )}
        </div>
        <Button
          onClick={handleProvision}
          disabled={isCommitting || selection.length === 0}
          className="gap-2 shrink-0"
        >
          <RiTeamLine className="size-4" />
          {isCommitting
            ? "Provisioning…"
            : `Provision ${selection.length} team${selection.length === 1 ? "" : "s"}`}
        </Button>
      </div>

      {result?.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
          <RiCheckLine className="size-4 shrink-0" />
          {result.boardsCreated === 0
            ? "No new teams created — everything selected already had a board."
            : `Created ${result.boardsCreated} team${result.boardsCreated === 1 ? "" : "s"} with ${result.membersCreated} member${result.membersCreated === 1 ? "" : "s"}.`}
          {result.skipped > 0 && ` Skipped ${result.skipped} that gained a board meanwhile.`}
        </div>
      )}
      {result && !result.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
          <span className="font-mono text-xs break-all">{result.error}</span>
        </div>
      )}

      {/* Filter toolbar — search + department */}
      {proposal.boards.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <RiSearchLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search manager, email, board or member…"
              className="pl-9"
            />
          </div>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPTS}>All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Proposed boards */}
      {actionable.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <RiCheckLine className="size-4 text-emerald-500" />
          Every Keka manager already has a Team Pulse board. Nothing to provision.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Proposed teams ({visibleActionable.length}
              {visibleActionable.length !== actionable.length ? ` of ${actionable.length}` : ""})
            </h2>
            {visibleActionable.length > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setAllShown(true)}
                  className="font-medium text-primary hover:text-primary/80"
                >
                  Select shown
                </button>
                <span className="text-zinc-300">·</span>
                <button
                  type="button"
                  onClick={() => setAllShown(false)}
                  className="font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Clear shown
                </button>
              </div>
            )}
          </div>
          {visibleActionable.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              No proposed teams match this filter.
            </div>
          ) : (
            visibleActionable.map((b) => (
              <BoardCard
                key={b.managerEmail}
                board={b}
                sel={sel[b.managerEmail]}
                onToggleBoard={(on) => setBoard(b.managerEmail, { included: on })}
                onRenameBoard={(name) => setBoard(b.managerEmail, { boardName: name })}
                onToggleMember={(email, on) => toggleMember(b.managerEmail, email, on)}
              />
            ))
          )}
        </div>
      )}

      {/* Skipped (already have a team) */}
      {skipped.length > 0 && visibleSkipped.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Already have a team ({visibleSkipped.length}
            {visibleSkipped.length !== skipped.length ? ` of ${skipped.length}` : ""})
          </h2>
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {visibleSkipped.map((b) => (
              <div key={b.managerEmail} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {b.managerName}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {b.managerEmail} · {b.members.length} report
                    {b.members.length === 1 ? "" : "s"}
                  </span>
                </div>
                {b.existingBoardId ? (
                  <Link href={`/observer/${b.existingBoardId}`}>
                    <Badge variant="secondary" className="shrink-0 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                      View team →
                    </Badge>
                  </Link>
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    Has a team
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rollback panel */}
      {runs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Provision history
          </h2>
          <p className="text-xs text-zinc-500">
            Rolling back deletes only the boards that run created (and their
            members). Hand-made boards are never touched.
          </p>
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} onDone={() => router.refresh()} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BoardCard({
  board,
  sel,
  onToggleBoard,
  onRenameBoard,
  onToggleMember,
}: {
  board: ProposedBoard;
  sel: BoardSel | undefined;
  onToggleBoard: (on: boolean) => void;
  onRenameBoard: (name: string) => void;
  onToggleMember: (email: string, on: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!sel) return null;
  const selectedCount = board.members.filter((m) => sel.members[m.email]).length;

  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-sm transition-colors dark:bg-zinc-900",
        sel.included
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-zinc-100 opacity-60 dark:border-zinc-800/50"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Checkbox
          checked={sel.included}
          onCheckedChange={(v) => onToggleBoard(v === true)}
          aria-label={`Include ${board.managerName}'s team`}
        />
        <div className="min-w-0 flex-1">
          <Input
            value={sel.boardName}
            onChange={(e) => onRenameBoard(e.target.value)}
            disabled={!sel.included}
            className="h-8 text-sm font-medium"
          />
          <span className="mt-1 block truncate text-xs text-zinc-500">
            {board.managerName} · {board.managerEmail}
            {board.department ? ` · ${board.department}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {selectedCount}/{board.members.length}
          <RiArrowDownSLine className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <ul className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            {board.members.map((m) => (
              <li key={m.email} className="flex items-center gap-3 py-2">
                <Checkbox
                  checked={sel.members[m.email] ?? false}
                  onCheckedChange={(v) => onToggleMember(m.email, v === true)}
                  disabled={!sel.included}
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
      )}
    </div>
  );
}

function RunRow({ run, onDone }: { run: ProvisionRunRow; onDone: () => void }) {
  const [isRolling, startRollback] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRollback() {
    startRollback(async () => {
      const r: RollbackResult = await rollbackProvision(run.id);
      if (!r.ok) setError(r.error);
      else onDone();
    });
  }

  return (
    <div className={cn("flex items-center gap-3 px-5 py-3", isRolling && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {run.boardsCreated} team{run.boardsCreated === 1 ? "" : "s"} ·{" "}
          {run.membersCreated} member{run.membersCreated === 1 ? "" : "s"}
          {run.status === "rolled_back" && (
            <Badge variant="secondary" className="shrink-0">Rolled back</Badge>
          )}
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {run.triggeredBy} · <ClientTime iso={run.createdAt} />
        </span>
        {error && (
          <span className="block truncate text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>

      {run.status === "active" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={isRolling}>
              <RiArrowGoBackLine className="size-4" />
              Roll back
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Roll back this run?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the {run.boardsCreated} board
                {run.boardsCreated === 1 ? "" : "s"} this run created and their{" "}
                {run.membersCreated} member{run.membersCreated === 1 ? "" : "s"}. Boards
                created any other way are not affected. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRollback}
                className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              >
                Roll back
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// Render timestamps only on the client to avoid an SSR/hydration mismatch.
const subscribe = () => () => {};
function ClientTime({ iso }: { iso: string }) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  return <>{isClient ? new Date(iso).toLocaleString() : "…"}</>;
}
