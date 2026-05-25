"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { RiRefreshLine, RiPencilLine, RiCheckLine, RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { updateFeatureFlag, dropFeatureFlagsCache } from "@/app/(app)/superuser/feature-flags/actions";
import type { ResolvedFlag } from "@/lib/feature-flags";

type EditState = {
  key: string;
  draft: string;
  error?: string;
};

export function FeatureFlagsPanel({ flags }: { flags: ResolvedFlag[] }) {
  const [editing, setEditing] = useState<EditState | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isCacheDropping, startCacheDrop] = useTransition();

  function startEdit(flag: ResolvedFlag) {
    setEditing({
      key: flag.key,
      draft: JSON.stringify(flag.value, null, 2),
    });
    setSavedKeys((prev) => {
      const next = new Set(prev);
      next.delete(flag.key);
      return next;
    });
  }

  function cancelEdit() {
    setEditing(null);
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const result = await updateFeatureFlag(editing.key, editing.draft);
      if (result.error) {
        setEditing((prev) => prev ? { ...prev, error: result.error } : null);
      } else {
        setSavedKeys((prev) => new Set(prev).add(editing.key));
        setEditing(null);
      }
    });
  }

  function dropCache() {
    startCacheDrop(async () => {
      await dropFeatureFlagsCache();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={dropCache}
          disabled={isCacheDropping}
          className="gap-1.5 text-xs"
        >
          <RiRefreshLine className={cn("size-3.5", isCacheDropping && "animate-spin")} />
          {isCacheDropping ? "Revalidating…" : "Drop cache"}
        </Button>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Key
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Value
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden md:table-cell">
                Description
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden lg:table-cell">
                Updated
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => {
              const isEditing = editing?.key === flag.key;
              const isSaved = savedKeys.has(flag.key);

              return (
                <tr
                  key={flag.key}
                  className={cn(
                    "border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 transition-colors",
                    isEditing && "bg-zinc-50 dark:bg-zinc-800/40"
                  )}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-zinc-700 dark:text-zinc-300 align-top">
                    {flag.key}
                  </td>

                  <td className="px-4 py-3 align-top min-w-[180px]">
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editing.draft}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev ? { ...prev, draft: e.target.value, error: undefined } : null
                            )
                          }
                          rows={3}
                          className={cn(
                            "w-full rounded-md border bg-white dark:bg-zinc-900 px-2 py-1.5 font-mono text-xs resize-y focus:outline-none focus:ring-1 focus:ring-ring",
                            editing.error
                              ? "border-destructive focus:ring-destructive"
                              : "border-zinc-300 dark:border-zinc-700"
                          )}
                          spellCheck={false}
                        />
                        {editing.error && (
                          <p className="text-[11px] text-destructive">{editing.error}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {flag.value === true ? (
                          <Badge variant="default" className="text-[11px] bg-emerald-500 hover:bg-emerald-500">
                            true
                          </Badge>
                        ) : flag.value === false ? (
                          <Badge variant="secondary" className="text-[11px]">
                            false
                          </Badge>
                        ) : (
                          <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                            {JSON.stringify(flag.value)}
                          </code>
                        )}
                        {flag.isDefault && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                            default
                          </span>
                        )}
                        {isSaved && (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Saved
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-xs text-zinc-500 align-top hidden md:table-cell">
                    {flag.description ?? "—"}
                  </td>

                  <td className="px-4 py-3 text-xs text-zinc-400 align-top hidden lg:table-cell whitespace-nowrap">
                    {flag.isDefault
                      ? <span className="text-zinc-300 dark:text-zinc-600">never set</span>
                      : formatDistanceToNow(new Date(flag.updatedAt), { addSuffix: true })
                    }
                  </td>

                  <td className="px-4 py-3 align-top">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={save}
                          disabled={isPending}
                        >
                          <RiCheckLine className="size-3" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={cancelEdit}
                          disabled={isPending}
                        >
                          <RiCloseLine className="size-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 text-zinc-500"
                        onClick={() => startEdit(flag)}
                      >
                        <RiPencilLine className="size-3" />
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}

            {flags.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No feature flags defined.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
