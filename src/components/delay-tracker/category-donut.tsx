"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { categoryColor } from "@/lib/delay-tracker/categories";

export type CategorySlice = { category: string; label: string; value: number };

/**
 * Presentational donut + legend for a category → count breakdown. Shared by
 * the per-issue delay history donut and the per-project delay panel so both
 * stay visually identical — callers pre-aggregate their own data shape into
 * this one. Colored via the delay-tracker category palette (categoryColor) —
 * every current caller in this feature uses that same palette, so it isn't a
 * prop.
 *
 * `onSliceClick`, when provided, makes both the wedge and its legend row
 * clickable (used by the per-project panel to drill into that category's
 * delayed issues); omitted entirely by the per-issue history donut, which
 * has nothing further to drill into.
 */
export function CategoryDonut({
  slices,
  size = 90,
  onSliceClick,
}: {
  slices: CategorySlice[];
  size?: number;
  onSliceClick?: (category: string) => void;
}) {
  const data = useMemo(
    () => slices.map((s) => ({ category: s.category, name: s.label, value: s.value, fill: categoryColor(s.category) })),
    [slices]
  );

  if (data.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={size * 0.27}
            outerRadius={size * 0.47}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.fill}
                cursor={onSliceClick ? "pointer" : undefined}
                onClick={onSliceClick ? () => onSliceClick(entry.category) : undefined}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  {payload[0].name}: {payload[0].value}
                </div>
              ) : null
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-0.5">
        {data.map((e) => {
          const swatchAndLabel = (
            <>
              <span className="flex items-center gap-1.5 truncate">
                <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: e.fill }} />
                <span className="truncate text-muted-foreground">{e.name}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{e.value}</span>
            </>
          );
          return onSliceClick ? (
            <button
              key={e.name}
              type="button"
              onClick={() => onSliceClick(e.category)}
              className="flex w-full items-center justify-between gap-2 rounded text-[11px] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {swatchAndLabel}
            </button>
          ) : (
            <div key={e.name} className="flex items-center justify-between gap-2 text-[11px]">
              {swatchAndLabel}
            </div>
          );
        })}
      </div>
    </div>
  );
}
