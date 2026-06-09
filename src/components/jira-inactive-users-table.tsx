"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  RiRefreshLine,
  RiUserLine,
  RiUserForbidLine,
  RiUserUnfollowLine,
  RiAlertLine,
} from "@remixicon/react";
import {
  findInactiveJiraUsers,
  unassignInactiveJiraUser,
  unassignInactiveJiraUsers,
  type InactiveJiraUser,
} from "@/app/(app)/admin/users/actions";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ScanState =
  | { status: "idle" }
  | { status: "scanning" }
  | { status: "done"; users: InactiveJiraUser[] }
  | { status: "error"; message: string };

export function JiraInactiveUsersTable() {
  const [state, setState] = useState<ScanState>({ status: "idle" });
  // accountId -> issues unassigned (row has been scrubbed)
  const [unassigned, setUnassigned] = useState<Record<string, number>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [bulkPending, startBulk] = useTransition();

  function handleScan() {
    setState({ status: "scanning" });
    setUnassigned({});
    startTransition(async () => {
      const result = await findInactiveJiraUsers();
      if (result.error) {
        setState({ status: "error", message: result.error });
      } else {
        setState({ status: "done", users: result.users ?? [] });
      }
    });
  }

  const scanning = state.status === "scanning";

  // Users still showing as assigned (not yet unassigned this session).
  const pending =
    state.status === "done"
      ? state.users.filter(
          (u) => unassigned[u.accountId] === undefined && u.issueCount > 0
        )
      : [];
  const pendingIssues = pending.reduce((sum, u) => sum + u.issueCount, 0);

  function handleBulkUnassign() {
    startBulk(async () => {
      const result = await unassignInactiveJiraUsers(pending.map((u) => u.accountId));
      if (result.error) {
        toast.error("Bulk unassign failed", { description: result.error });
        return;
      }
      const cleared = new Set(result.clearedAccountIds ?? []);
      setUnassigned((prev) => {
        const next = { ...prev };
        for (const u of pending) {
          if (cleared.has(u.accountId)) next[u.accountId] = u.issueCount;
        }
        return next;
      });
      const skipped = result.skippedActive ?? 0;
      toast.success(
        `Unassigned ${cleared.size} user${cleared.size === 1 ? "" : "s"} from ${
          result.updated ?? 0
        } issue${result.updated === 1 ? "" : "s"}` +
          (skipped > 0 ? ` · ${skipped} skipped (active in Jira)` : "")
      );
      setBulkOpen(false);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Inactive Jira Users
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Accounts deactivated in Jira (e.g. people who left) that still appear
            as assignee on synced issues. Unassign clears them locally — a full
            re-sync may re-populate any issue still assigned to them in Jira.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pending.length > 0 && (
            <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="lg" disabled={bulkPending}>
                  <RiUserUnfollowLine />
                  Unassign all ({pending.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <RiAlertLine className="size-5 text-red-500 shrink-0" />
                    Unassign all inactive users?
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>
                        This clears the assignee on{" "}
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {pendingIssues} issue{pendingIssues === 1 ? "" : "s"}
                        </span>{" "}
                        across{" "}
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {pending.length} inactive user
                          {pending.length === 1 ? "" : "s"}
                        </span>
                        . Each account is re-checked against Jira first — any that
                        turn out to be active are skipped.
                      </p>
                      <p className="text-xs">
                        Local only: a full project sync re-populates assignees still
                        set in Jira. The issues themselves are not deleted.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={bulkPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleBulkUnassign();
                    }}
                    disabled={bulkPending}
                    className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
                  >
                    {bulkPending ? "Unassigning…" : `Unassign all (${pending.length})`}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button onClick={handleScan} disabled={scanning} size="lg" variant="outline">
            <RiRefreshLine className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning…" : "Scan for inactive users"}
          </Button>
        </div>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}

      {state.status === "done" && state.users.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <RiUserLine className="size-4" />
          No inactive Jira users found.
        </div>
      )}

      {state.status === "done" && state.users.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Jira User
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Email
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Account ID
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 w-36">
                  Assigned Issues
                </th>
                <th className="px-4 py-2.5 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {state.users.map((u) => (
                <InactiveUserRow
                  key={u.accountId}
                  user={u}
                  unassignedCount={unassigned[u.accountId]}
                  onUnassigned={(count) =>
                    setUnassigned((prev) => ({ ...prev, [u.accountId]: count }))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InactiveUserRow({
  user,
  unassignedCount,
  onUnassigned,
}: {
  user: InactiveJiraUser;
  unassignedCount: number | undefined;
  onUnassigned: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isDone = unassignedCount !== undefined;

  function handleConfirm() {
    startTransition(async () => {
      const result = await unassignInactiveJiraUser(user.accountId);
      if (result.error) {
        toast.error(`Could not unassign ${user.name}`, {
          description: result.error,
        });
      } else {
        onUnassigned(result.updated ?? 0);
        toast.success(
          `Unassigned ${user.name} from ${result.updated ?? 0} issue${
            result.updated === 1 ? "" : "s"
          }`
        );
        setOpen(false);
      }
    });
  }

  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
            <RiUserForbidLine className="size-3.5 text-red-400" />
          </div>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {user.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-300">
        {user.email ?? <span className="text-zinc-400">—</span>}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400 dark:text-zinc-500">
        {user.accountId}
      </td>
      <td className="px-4 py-2.5 text-right">
        {isDone ? (
          <Badge variant="secondary">unassigned</Badge>
        ) : user.issueCount > 0 ? (
          <Badge variant="destructive">{user.issueCount}</Badge>
        ) : (
          <span className="text-zinc-400">0</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {!isDone && user.issueCount > 0 && (
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending}>
                <RiUserUnfollowLine />
                Unassign
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <RiAlertLine className="size-5 text-red-500 shrink-0" />
                  Unassign {user.name}?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      This clears the assignee on{" "}
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {user.issueCount} issue{user.issueCount === 1 ? "" : "s"}
                      </span>{" "}
                      in the local database. The issues themselves are not deleted.
                    </p>
                    <p className="text-xs">
                      A full project sync re-fetches every issue from Jira and will
                      re-populate the assignee for any issue still assigned to this
                      account there.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    handleConfirm();
                  }}
                  disabled={isPending}
                  className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
                >
                  {isPending ? "Unassigning…" : "Unassign"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </td>
    </tr>
  );
}
