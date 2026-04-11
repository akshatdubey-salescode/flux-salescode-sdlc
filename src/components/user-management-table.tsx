"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { RiSaveLine, RiSearchLine, RiUserLine } from "@remixicon/react";
import { updateUserRoles } from "@/app/(app)/admin/users/actions";
import type { UserRole } from "@/lib/auth/types";

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
};

type Props = {
  users: UserRow[];
  currentUserId: string;
  total: number;
  page: number;
  pageSize: number;
  search: string;
};

const ROLE_OPTIONS: UserRole[] = ["USER", "ADMIN", "SUPERUSER"];

const ROLE_BADGE: Record<UserRole, string> = {
  USER: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  ADMIN: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  SUPERUSER: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
};

export function UserManagementTable({
  users,
  currentUserId,
  total,
  page,
  pageSize,
  search,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Track pending role changes: userId → new role
  const [pendingChanges, setPendingChanges] = useState<Record<string, UserRole>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const totalPages = Math.ceil(total / pageSize);
  const hasChanges = Object.keys(pendingChanges).length > 0;

  function handleRoleChange(userId: string, originalRole: UserRole, newRole: UserRole) {
    setSaveSuccess(false);
    setSaveError(null);
    setPendingChanges((prev) => {
      const next = { ...prev };
      if (newRole === originalRole) {
        delete next[userId];
      } else {
        next[userId] = newRole;
      }
      return next;
    });
  }

  function handleSave() {
    const updates = Object.entries(pendingChanges).map(([id, role]) => ({ id, role }));
    startTransition(async () => {
      const result = await updateUserRoles(updates);
      if (result.error) {
        setSaveError(result.error);
      } else {
        setPendingChanges({});
        setSaveSuccess(true);
      }
    });
  }

  function handleSearch(q: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (q) {
      params.set("q", q);
    } else {
      params.delete("q");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function handlePage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p > 1) {
      params.set("page", String(p));
    } else {
      params.delete("page");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by email…"
            defaultValue={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full h-8 rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {saveError && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">{saveError}</p>
          )}
          {saveSuccess && !hasChanges && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Saved successfully</p>
          )}
          {hasChanges && (
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {Object.keys(pendingChanges).length} unsaved change{Object.keys(pendingChanges).length !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <RiSaveLine className="size-3.5" />
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                User
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Joined
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 w-40">
                Role
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center text-sm text-zinc-500">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const effectiveRole = pendingChanges[u.id] ?? u.role;
                const isChanged = u.id in pendingChanges;
                const isSelf = u.id === currentUserId;

                return (
                  <tr
                    key={u.id}
                    className={`group transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/30 ${
                      isChanged ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <RiUserLine className="size-3.5 text-zinc-400" />
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {u.email}
                          </span>
                          {isSelf && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                              You
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {u.createdAt.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={effectiveRole}
                          disabled={isSelf}
                          onChange={(e) =>
                            handleRoleChange(u.id, u.role, e.target.value as UserRole)
                          }
                          className={`h-7 rounded-md border px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-zinc-100/10 transition-colors ${ROLE_BADGE[effectiveRole]} ${
                            isChanged
                              ? "border-amber-300 dark:border-amber-700"
                              : "border-zinc-200 dark:border-zinc-700"
                          }`}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        {isChanged && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            Changed
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {start}–{end} of {total} user{total !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              className="rounded-md border border-zinc-200 px-2.5 py-1 font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Previous
            </button>
            <span className="px-2 font-medium">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              className="rounded-md border border-zinc-200 px-2.5 py-1 font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
