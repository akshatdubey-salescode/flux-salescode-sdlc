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
    label: "Time (hrs)",
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
          content={
            <ChartTooltipContent
              formatter={(value: unknown) => {
                const hrs = Number(value)
                if (hrs >= 24) return [`${(hrs / 24).toFixed(2)} days`, "Time spent"]
                if (hrs < 1) return [`${Math.round(hrs * 60)} mins`, "Time spent"]
                return [`${hrs.toFixed(2)} hrs`, "Time spent"]
              }}
            />
          }
        />
        <Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
