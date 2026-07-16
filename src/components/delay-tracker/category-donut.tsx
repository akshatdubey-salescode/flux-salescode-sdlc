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
 */
export function CategoryDonut({ slices, size = 90 }: { slices: CategorySlice[]; size?: number }) {
  const data = useMemo(
    () => slices.map((s) => ({ name: s.label, value: s.value, fill: categoryColor(s.category) })),
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
              <Cell key={i} fill={entry.fill} />
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
        {data.map((e) => (
          <div key={e.name} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 truncate">
              <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: e.fill }} />
              <span className="truncate text-muted-foreground">{e.name}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums">{e.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
