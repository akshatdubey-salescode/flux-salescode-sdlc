"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiLoader4Line, RiCheckLine } from "@remixicon/react";
import { MarkdownEditor, splitContent } from "@/components/ui/markdown-editor";

type Props = {
  id: string;
  initial: {
    title: string;
    description: string;
    acceptanceCriteria: string;
  };
};

export function EditForm({ id, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(
    initial.acceptanceCriteria
      ? `${initial.description}\n\n## Acceptance Criteria\n\n${initial.acceptanceCriteria}`
      : initial.description
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError("");
    const { description, acceptanceCriteria } = splitContent(content);
    try {
      const res = await fetch(`/api/requirements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description,
          acceptanceCriteria: acceptanceCriteria ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push(`/requirements/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <MarkdownEditor
          label="Content"
          required
          value={content}
          onChange={setContent}
          rows={18}
          placeholder={`Describe the requirement in full...\n\nTo include acceptance criteria, add a ## Acceptance Criteria heading.`}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !title.trim() || !content.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <RiLoader4Line className="animate-spin" size={15} />
          ) : (
            <RiCheckLine size={15} />
          )}
          Save Changes
        </button>
      </div>
    </div>
  );
}
