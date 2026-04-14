"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export type StatusTimeEntry = {
  status: string
  hours: number
}

const chartConfig = {
  hours: {
    label: "Time spent",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

export function StatusTimeChart({ data }: { data: StatusTimeEntry[] }) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-zinc-400">No status history available yet.</p>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="status"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) =>
            v >= 24 ? `${(v / 24).toFixed(1)}d` : `${v.toFixed(1)}h`
          }
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(label) => String(label)}
              className="min-w-[180px]"
              formatter={(value, _name, item) => {
                const hrs = Number(value)
                const formatted =
                  hrs >= 24
                    ? `${(hrs / 24).toFixed(1)}d`
                    : hrs < 1
                    ? `${Math.round(hrs * 60)}m`
                    : `${hrs.toFixed(1)}h`
                const color = item.payload?.fill ?? item.color
                return (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex flex-1 justify-between items-center leading-none gap-4">
                      <span className="text-muted-foreground">Time spent</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatted}
                      </span>
                    </div>
                  </>
                )
              }}
            />
          }
        />
        <Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
