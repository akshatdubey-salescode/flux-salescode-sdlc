"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import debounce from "lodash/debounce";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RiUserSearchLine, RiLoaderLine } from "@remixicon/react";

type Developer = {
  email: string;
  name: string;
  jira_account_id: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function avatarColor(email: string) {
  const colors = [
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

export function AssigneePicker({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchDevelopers = useMemo(
    () =>
      debounce(async (q: string) => {
        setLoading(true);
        try {
          const params = new URLSearchParams({ limit: "5" });
          if (q) params.set("q", q);
          const res = await fetch(`/api/observer/developers?${params}`);
          const data: Developer[] = await res.json();
          setDevelopers(Array.isArray(data) ? data : []);
        } catch {
          setDevelopers([]);
        } finally {
          setLoading(false);
        }
      }, 300),
    []
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDevelopers([]);
      return;
    }
    fetchDevelopers("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, fetchDevelopers]);

  useEffect(() => {
    if (!open) return;
    fetchDevelopers(query);
  }, [query, open, fetchDevelopers]);

  useEffect(() => {
    return () => fetchDevelopers.cancel();
  }, [fetchDevelopers]);

  function handleSelect(email: string) {
    onOpenChange(false);
    router.push(`/tasks/${encodeURIComponent(email)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-sm overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            <RiUserSearchLine className="size-4 text-zinc-400" />
            Whose bandwidth are you curious about?
          </DialogTitle>
        </DialogHeader>

        <div className="px-3 pt-3 pb-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="h-8 text-xs"
          />
        </div>

        <div className="pb-2 min-h-[72px]">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <RiLoaderLine className="size-4 text-zinc-400 animate-spin" />
            </div>
          ) : developers.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400">
              {query ? "No matching team members." : "No assignees found."}
            </p>
          ) : (
            <ul>
              {developers.map((dev) => (
                <li key={dev.email}>
                  <button
                    onClick={() => handleSelect(dev.email)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarColor(dev.email)}`}
                    >
                      {initials(dev.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100 truncate">
                        {dev.name}
                      </p>
                      <p className="text-[10px] text-zinc-400 truncate">{dev.email}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
