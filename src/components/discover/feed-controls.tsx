"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function FeedControls({ mineCount }: { mineCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "mine" ? "mine" : "all";
  const sort = params.get("sort") === "popular" ? "popular" : "newest";
  const activeTag = params.get("tag") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Debounced search-as-you-type.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q.trim() === current) return;
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <Tabs value={tab} onValueChange={(v) => update({ tab: v === "mine" ? "mine" : null })}>
        <TabsList>
          <TabsTrigger value="all">All tools</TabsTrigger>
          <TabsTrigger value="mine" className="gap-1.5">
            Yours
            {mineCount > 0 && (
              <span className="rounded-full bg-zinc-200 px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {mineCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "all" && activeTag && (
        <button
          type="button"
          onClick={() => update({ tag: null })}
          title="Clear tag filter"
          className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
        >
          #{activeTag}
          <RiCloseLine size={12} />
        </button>
      )}
      {tab === "all" && (
        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          <div className="relative flex-1 sm:w-72 sm:flex-none">
            <RiSearchLine size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <Input
              type="search"
              aria-label="Search tools"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, tag or description"
              className="pl-8"
            />
          </div>
          <Tabs value={sort} onValueChange={(v) => update({ sort: v === "popular" ? "popular" : null })}>
            <TabsList>
              <TabsTrigger value="newest">Newest</TabsTrigger>
              <TabsTrigger value="popular">Popular</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
    </div>
  );
}
