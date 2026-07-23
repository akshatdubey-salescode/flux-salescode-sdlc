"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiSearchLine, RiUserLine } from "@remixicon/react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/lib/auth/types";

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  canManageDeliveries: boolean;
  name: string | null;
};

type Props = {
  users: UserRow[];
  search: string;
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Search-then-instant-toggle admin screen — deliberately simpler than
 * UserManagementTable's batched pending-changes/Save flow, since this is a
 * single low-stakes boolean rather than a role change: each toggle saves
 * immediately with its own toast, no "unsaved changes" state to track.
 */
export function DeliveryManagersTable({ users, search, total, page, pageSize }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState(users);

  const totalPages = Math.ceil(total / pageSize);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/superuser/delivery-managers?q=${encodeURIComponent(query)}`);
  }

  function handlePage(p: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 1) params.set("page", String(p));
    router.push(`/superuser/delivery-managers${params.toString() ? `?${params}` : ""}`);
  }

  async function handleToggle(userId: string, next: boolean) {
    setPendingIds((prev) => new Set(prev).add(userId));
    setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, canManageDeliveries: next } : u)));
    try {
      const res = await fetch(`/api/superuser/delivery-managers/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canManageDeliveries: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(next ? "Delivery access granted" : "Delivery access revoked");
    } catch {
      // Revert on failure
      setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, canManageDeliveries: !next } : u)));
      toast.error("Failed to update — try again");
    } finally {
      setPendingIds((prev) => {
        const remaining = new Set(prev);
        remaining.delete(userId);
        return remaining;
      });
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or name…"
            className="pl-8 h-8 text-sm"
          />
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Name</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Email</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Role</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Can manage deliveries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No users match this search.
                </td>
              </tr>
            ) : (
              rows.map((u) => {
                const isAdmin = u.role === "ADMIN" || u.role === "SUPERUSER";
                return (
                  <tr key={u.id} className="bg-white dark:bg-zinc-950">
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                      <span className="inline-flex items-center gap-1.5">
                        <RiUserLine className="size-3.5 text-zinc-400" />
                        {u.name ?? <span className="text-zinc-400">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">
                        {u.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {isAdmin ? (
                        <span className="text-xs text-zinc-400">Already has access (Admin)</span>
                      ) : (
                        <Checkbox
                          checked={u.canManageDeliveries}
                          disabled={pendingIds.has(u.id)}
                          onCheckedChange={(checked) => handleToggle(u.id, checked === true)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
