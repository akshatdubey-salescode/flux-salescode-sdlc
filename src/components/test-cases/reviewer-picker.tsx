"use client";

import { RiCloseLine } from "@remixicon/react";
import { PersonPicker } from "@/components/delay-tracker/person-picker";

export type Reviewer = { email: string; name: string | null };

/**
 * Multi-person selection built from the existing single-person picker: each
 * pick is added to the list and the picker resets, so reviewers show as chips.
 */
export function ReviewerPicker({
  value,
  onChange,
  disabledEmail,
}: {
  value: Reviewer[];
  onChange: (next: Reviewer[]) => void;
  /** The submitter, who cannot also be a reviewer. */
  disabledEmail?: string;
}) {
  const add = (p: { email: string; name: string } | null) => {
    if (!p) return;
    const email = p.email.toLowerCase();
    if (email === disabledEmail?.toLowerCase()) return;
    if (value.some((r) => r.email === email)) return;
    onChange([...value, { email, name: p.name || null }]);
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((r) => (
            <li
              key={r.email}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 py-0.5 pl-2.5 pr-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <span className="font-medium text-foreground">{r.name ?? r.email}</span>
              {r.name && <span className="text-muted-foreground">{r.email}</span>}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.email !== r.email))}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-zinc-200 hover:text-foreground dark:hover:bg-zinc-700"
                aria-label={`Remove ${r.name ?? r.email}`}
              >
                <RiCloseLine className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="max-w-xs">
        <PersonPicker value={null} onChange={add} />
      </div>
    </div>
  );
}
