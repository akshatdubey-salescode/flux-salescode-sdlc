"use client";

import { useState, useTransition } from "react";
import { RiRefreshLine, RiUserLine } from "@remixicon/react";
import { syncJiraUserEmail } from "@/app/(app)/admin/users/actions";

type JiraUser = {
  accountId: string;
  name: string;
};

type RowState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; email: string }
  | { status: "error"; message: string };

export function JiraUserSyncTable({ users }: { users: JiraUser[] }) {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [, startTransition] = useTransition();

  function setState(accountId: string, state: RowState) {
    setStates((prev) => ({ ...prev, [accountId]: state }));
  }

  function handleSync(accountId: string) {
    setState(accountId, { status: "syncing" });
    startTransition(async () => {
      const result = await syncJiraUserEmail(accountId);
      if (result.error) {
        setState(accountId, { status: "error", message: result.error });
      } else {
        setState(accountId, { status: "done", email: result.email! });
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Jira User
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Account ID
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 w-48">
              Status
            </th>
            <th className="px-4 py-2.5 w-32" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {users.map((u) => {
            const state = states[u.accountId] ?? { status: "idle" };
            const isSyncing = state.status === "syncing";

            return (
              <tr key={u.accountId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <RiUserLine className="size-3.5 text-zinc-400" />
                    </div>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{u.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                  {u.accountId}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {state.status === "idle" && (
                    <span className="text-zinc-400">No email on record</span>
                  )}
                  {state.status === "syncing" && (
                    <span className="text-zinc-500">Syncing…</span>
                  )}
                  {state.status === "done" && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {state.email}
                    </span>
                  )}
                  {state.status === "error" && (
                    <span className="text-red-600 dark:text-red-400">{state.message}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {state.status !== "done" && (
                    <button
                      onClick={() => handleSync(u.accountId)}
                      disabled={isSyncing}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <RiRefreshLine className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                      {isSyncing ? "Syncing" : "Sync Email"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
