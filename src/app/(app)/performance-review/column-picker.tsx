"use client";

// Superuser-only "which numeric columns show" picker — a friendlier UI over
// the same feature_flags.performanceReviewVisibleColumns row the raw
// superuser/feature-flags JSON editor already edits (see actions.ts'
// updateVisibleColumns). Every toggle writes straight through and refreshes
// the page; there's no separate "Save" step and no local/per-user state —
// this is a shared, org-wide default, same as everywhere else that flag is
// read (getVisibleColumns, uncached).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NUMERIC_COLUMNS } from "./leaderboard-table";
import type { SortKey } from "./rating-sort";
import { updateVisibleColumns } from "./actions";

export function ColumnPicker({ visibleColumns }: { visibleColumns: SortKey[] }) {
  const [checked, setChecked] = useState<Set<SortKey>>(new Set(visibleColumns));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Resync when the server-fetched visibleColumns prop changes underneath us
  // (a quarter switch, a Recompute refresh, another superuser's edit) — this
  // component doesn't remount on those, so without this the checkboxes would
  // silently keep showing whatever was checked at mount time. Adjusted during
  // render (React's own recommended pattern for "derive state from a prop
  // change") rather than in a useEffect, which would cost an extra render
  // pass for what's really just synchronizing with the latest prop.
  const [prevVisibleColumns, setPrevVisibleColumns] = useState(visibleColumns);
  if (visibleColumns !== prevVisibleColumns) {
    setPrevVisibleColumns(visibleColumns);
    setChecked(new Set(visibleColumns));
  }

  function toggle(key: SortKey, next: boolean) {
    const nextChecked = new Set(checked);
    if (next) {
      nextChecked.add(key);
    } else {
      nextChecked.delete(key);
    }
    if (nextChecked.size === 0) {
      toast.error("Keep at least one column visible.");
      return;
    }

    setChecked(nextChecked);
    startTransition(async () => {
      const res = await updateVisibleColumns(Array.from(nextChecked));
      if (res.error) {
        toast.error(res.error);
        setChecked(checked);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className="outline-none text-[10px] font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
        >
          Customize columns
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {NUMERIC_COLUMNS.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={checked.has(col.key)}
            disabled={isPending}
            onCheckedChange={(next) => toggle(col.key, next)}
            onSelect={(e) => e.preventDefault()}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
