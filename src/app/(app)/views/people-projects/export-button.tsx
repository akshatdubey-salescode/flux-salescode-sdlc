"use client";

import { useState } from "react";
import { RiDownload2Line } from "@remixicon/react";

type Props = {
  start: string;
  end: string;
  q: string;
  departments: string[];
};

export function ExportButton({ start, end, q, departments }: Props) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ start, end });
      if (q.trim()) params.set("q", q.trim());
      if (departments.length) params.set("dept", departments.join(","));
      const res = await fetch(`/api/views/people-projects/export?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `people-projects-${start}-to-${end}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user can retry
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        title="Excel workbook with 5 sheets: per-person summary, per-project breakdown, GitHub repos contributed to, every owned bug with Jira links, and bugs missing an issue owner — scoped to the filters currently applied."
      >
        <RiDownload2Line className="size-3.5" />
        {exporting ? "Preparing report…" : "Download Detailed Report"}
      </button>
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
        Excel · 5 sheets: Summary · By Project · Repos · Bug Jiras · Unowned Bugs
      </span>
    </div>
  );
}
