"use client";

import { useRef, useState } from "react";

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1400&q=80";

type Props = {
  projectId: string;
  initialUrl: string | null;
  isAdmin: boolean;
};

export function ProjectHeaderImage({ projectId, initialUrl, isAdmin }: Props) {
  const [imageUrl, setImageUrl] = useState(initialUrl ?? DEFAULT_IMAGE);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function openEdit() {
    setDraft(imageUrl === DEFAULT_IMAGE ? "" : imageUrl);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  async function handleSave() {
    const url = draft.trim();
    if (!url) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/header-image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerImageUrl: url }),
      });
      if (res.ok) setImageUrl(url);
    } finally {
      setSaving(false);
      setIsEditing(false);
    }
  }

  return (
    <div className="group relative h-52 w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Project cover"
        className="h-full w-full object-cover"
        onError={() => setImageUrl(DEFAULT_IMAGE)}
      />

      {/* Admin hover overlay — only shown on hover, not while editing */}
      {isAdmin && !isEditing && (
        <div className="absolute inset-0 flex items-end justify-end bg-black/0 p-3 transition-colors duration-200 group-hover:bg-black/40">
          <button
            onClick={openEdit}
            className="translate-y-1.5 rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-900 opacity-0 shadow transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:bg-white"
          >
            Edit cover
          </button>
        </div>
      )}

      {/* Inline edit bar at bottom of image */}
      {isEditing && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-4 py-3 backdrop-blur-sm">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setIsEditing(false);
            }}
            placeholder="Paste an image URL…"
            className="flex-1 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white placeholder-white/50 outline-none focus:border-white/40 focus:bg-white/15"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 transition-opacity disabled:opacity-60 hover:bg-zinc-100"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="rounded-md px-3 py-1.5 text-xs text-white/70 transition-colors hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
