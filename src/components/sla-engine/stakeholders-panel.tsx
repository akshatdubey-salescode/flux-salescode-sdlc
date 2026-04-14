"use client";

import { useState, useCallback } from "react";
import { RiAddLine, RiDeleteBinLine, RiLoader4Line, RiUserLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Stakeholder = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

type Props = {
  projectId: string;
  stakeholders: Stakeholder[];
  loading: boolean;
  onRefresh: () => void;
};

export function StakeholdersPanel({ projectId, stakeholders, loading, onRefresh }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    const trimName = name.trim();
    const trimEmail = email.trim().toLowerCase();
    if (!trimName || !trimEmail) return;

    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/stakeholders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimName, email: trimEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddError((data as { error?: string }).error ?? "Failed to add stakeholder");
        return;
      }
      setName("");
      setEmail("");
      onRefresh();
    } finally {
      setAdding(false);
    }
  }, [name, email, projectId, onRefresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/projects/${projectId}/stakeholders/${id}`, {
        method: "DELETE",
      });
      onRefresh();
    },
    [projectId, onRefresh]
  );

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Add a stakeholder
        </p>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={adding || !name.trim() || !email.trim()}
          >
            {adding ? (
              <RiLoader4Line className="size-3.5 animate-spin" />
            ) : (
              <RiAddLine className="size-3.5" />
            )}
            Add
          </Button>
        </div>
        {addError && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400">{addError}</p>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <RiLoader4Line className="size-5 animate-spin text-zinc-400" />
        </div>
      ) : stakeholders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RiUserLine className="mx-auto mb-2 size-7 text-zinc-300 dark:text-zinc-600" />
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            No stakeholders yet
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Add people to quickly include them in SLA rule notifications.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {stakeholders.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  {s.name}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {s.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                className="text-zinc-400 transition-colors hover:text-red-500"
                aria-label="Remove stakeholder"
              >
                <RiDeleteBinLine className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
