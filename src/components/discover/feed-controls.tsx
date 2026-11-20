"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function FeedControls({
  tags,
  mineCount,
}: {
  tags: { tag: string; count: number }[];
  mineCount: number;
}) {
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => update({ tab: v === "mine" ? "mine" : null })}>
          <TabsList>
            <TabsTrigger value="all">All showcases</TabsTrigger>
            <TabsTrigger value="mine">My showcases{mineCount ? ` (${mineCount})` : ""}</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "all" && (
          <>
            <div className="relative min-w-[220px] flex-1 max-w-md">
              <RiSearchLine size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tools…"
                className="pl-8"
              />
            </div>
            <Tabs value={sort} onValueChange={(v) => update({ sort: v === "popular" ? "popular" : null })}>
              <TabsList>
                <TabsTrigger value="newest">Newest</TabsTrigger>
                <TabsTrigger value="popular">Popular</TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        )}
      </div>
      {tab === "all" && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 24).map(({ tag, count }) => {
            const active = tag === activeTag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => update({ tag: active ? null : tag })}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                #{tag}
                <span className={active ? "opacity-80" : "text-zinc-400"}>{count}</span>
                {active && <RiCloseLine size={12} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
