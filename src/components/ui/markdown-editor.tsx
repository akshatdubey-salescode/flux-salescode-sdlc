"use client";

import { useState } from "react";
import { Markdown } from "./markdown";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
  required?: boolean;
};

export function MarkdownEditor({ value, onChange, placeholder, rows = 16, label, required }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 focus-within:border-zinc-400 dark:focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-400 dark:focus-within:ring-zinc-500 transition-shadow bg-white dark:bg-zinc-900">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border-b border-zinc-100 dark:border-zinc-800 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setTab("write")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === "write"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === "preview"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            Preview
          </button>
          <span className="ml-auto text-[10px] text-zinc-300 dark:text-zinc-600 pr-1">Markdown</span>
        </div>

        {tab === "write" ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className="w-full resize-y bg-transparent px-4 py-3 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none leading-relaxed"
          />
        ) : (
          <div className="min-h-[200px] px-4 py-3">
            {value.trim() ? (
              <Markdown content={value} />
            ) : (
              <p className="text-sm text-zinc-400 italic">Nothing to preview.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function splitContent(content: string): {
  description: string;
  acceptanceCriteria: string | undefined;
} {
  const idx = content.search(/^##\s+Acceptance Criteria\b/im);
  if (idx === -1) return { description: content.trim(), acceptanceCriteria: undefined };
  const description = content.slice(0, idx).trim();
  const ac = content
    .slice(idx)
    .replace(/^##\s+Acceptance Criteria\b\n*/im, "")
    .trim();
  return { description, acceptanceCriteria: ac || undefined };
}
