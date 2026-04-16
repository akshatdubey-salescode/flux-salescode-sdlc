"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiSearchLine, RiLinkM, RiPaletteLine, RiLoader4Line } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { HEADER_PALETTE, paletteColorForId } from "@/lib/header-palette";
import type { ImageSearchResult } from "@/app/api/images/search/route";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";

type PickerTab = "search" | "color" | "url";

type Props = {
  projectId: string;
  projectName: string;
  initialImageUrl: string | null;
  initialColor: string | null;
  isAdmin: boolean;
  isSuperuser: boolean;
};

export function ProjectHeaderImage({
  projectId,
  projectName,
  initialImageUrl,
  initialColor,
  isAdmin,
  isSuperuser,
}: Props) {
  const defaultColor = initialColor ?? paletteColorForId(projectId);

  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [color, setColor] = useState<string>(defaultColor);
  const [customColor, setCustomColor] = useState<string>(defaultColor);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("search");

  // Search state
  const [query, setQuery] = useState("software development");
  const [results, setResults] = useState<ImageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // URL tab state
  const [draft, setDraft] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/images/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json() as { results?: ImageSearchResult[]; error?: string };
      if (!res.ok) {
        setSearchError(data.error ?? "Search failed");
      } else {
        setResults(data.results ?? []);
        setHasSearched(true);
      }
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      setHasSearched(false);
      search(query);
    }, 1000);
    return () => clearTimeout(timer);
  }, [query, search]);

  // Auto-search when picker opens on search tab
  useEffect(() => {
    if (pickerOpen && tab === "search" && !hasSearched && !searching) {
      search(query);
    }
  }, [pickerOpen, tab, hasSearched, searching, search, query]);

  // Focus right input when switching tabs
  useEffect(() => {
    if (!pickerOpen) return;
    if (tab === "search") setTimeout(() => searchInputRef.current?.focus(), 30);
    if (tab === "url") {
      setDraft(imageUrl ?? "");
      setTimeout(() => urlInputRef.current?.focus(), 30);
    }
  }, [tab, pickerOpen, imageUrl]);

  async function save(type: "image" | "color", value: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/header-image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value }),
      });
      if (res.ok) {
        if (type === "image") {
          setImageUrl(value);
          setColor(paletteColorForId(projectId)); // reset color fallback
        } else {
          setColor(value);
          setImageUrl(null);
        }
        setPickerOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function openPicker() {
    setPickerOpen(true);
    setTab("search");
    setCustomColor(color);
  }

  const showImage = !!imageUrl;
  const proxiedUrl = imageUrl
    ? `/api/images/proxy?url=${encodeURIComponent(imageUrl)}`
    : null;

  return (
    <div>
      {/* Header display */}
      <div
        className="group relative h-52 w-full overflow-hidden"
        style={showImage ? undefined : { backgroundColor: color }}
      >
        {showImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxiedUrl!}
            alt="Project cover"
            className="h-full w-full object-cover"
            onError={() => setImageUrl(null)}
          />
        )}

        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

        <div className="absolute bottom-4 left-6 z-10 pointer-events-none">
          <h1 className="text-4xl font-semibold text-white drop-shadow-md">
            {projectName}
          </h1>
        </div>

        {isAdmin && !pickerOpen && (
          <div className="absolute inset-0 flex items-end justify-end bg-black/0 p-3 transition-colors duration-200 group-hover:bg-black/40">
            <div className="flex items-center gap-2">
              {isSuperuser && (
                <DeleteProjectDialog
                  projectId={projectId}
                  projectName={projectName}
                />
              )}
              <button
                type="button"
                onClick={openPicker}
                className="translate-y-1.5 rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-900 opacity-0 shadow transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:bg-white"
              >
                Edit cover
              </button>
            </div>
          </div>
        )}

        {isAdmin && pickerOpen && (
          <div className="absolute inset-0 bg-black/20" />
        )}
      </div>

      {/* Picker panel */}
      {isAdmin && pickerOpen && (
        <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          {/* Tab bar */}
          <div className="flex items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
            {(
              [
                { id: "search" as PickerTab, icon: RiSearchLine, label: "Search" },
                { id: "color" as PickerTab, icon: RiPaletteLine, label: "Color" },
                { id: "url" as PickerTab, icon: RiLinkM, label: "URL" },
              ] as const
            ).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                  tab === id
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                )}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="ml-auto text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>

          {/* Search tab */}
          {tab === "search" && (
            <div className="space-y-3 p-4">
              <form className="flex gap-2">
                <div className="relative flex-1">
                  <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Pixabay…"
                    className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Search
                </button>
              </form>

              {searchError ? (
                <p className="py-6 text-center text-xs text-red-500">{searchError}</p>
              ) : searching ? (
                <div className="flex items-center justify-center py-8">
                  <RiLoader4Line className="size-5 animate-spin text-zinc-400" />
                </div>
              ) : results.length === 0 && hasSearched ? (
                <p className="py-6 text-center text-xs text-zinc-400">No results found</p>
              ) : results.length > 0 ? (
                <div className="grid max-h-52 grid-cols-4 gap-2 overflow-y-auto">
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => save("image", r.fullUrl)}
                      disabled={saving}
                      title={r.tags}
                      className="group/thumb relative aspect-video overflow-hidden rounded-md bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.thumbUrl}
                        alt={r.tags}
                        className="h-full w-full object-cover transition-transform duration-150 group-hover/thumb:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/0 transition-colors group-hover/thumb:bg-black/20" />
                      <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
                        {r.author}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Color tab */}
          {tab === "color" && (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-8 gap-2">
                {HEADER_PALETTE.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => save("color", hex)}
                    disabled={saving}
                    title={hex}
                    className={cn(
                      "h-8 w-full rounded-md transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-zinc-500",
                      color === hex && !imageUrl
                        ? "ring-2 ring-zinc-900 ring-offset-2 dark:ring-zinc-100"
                        : ""
                    )}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-zinc-500"
                  disabled={saving}
                  title="Choose custom color"
                />
                <input
                  type="text"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs uppercase placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  placeholder="#000000"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => customColor.trim() && save("color", customColor.trim())}
                  disabled={saving || !customColor.trim()}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {saving ? "Saving…" : "Apply"}
                </button>
              </div>
            </div>
          )}

          {/* URL tab */}
          {tab === "url" && (
            <div className="flex items-center gap-2 p-4">
              <input
                ref={urlInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) save("image", draft.trim());
                  if (e.key === "Escape") setPickerOpen(false);
                }}
                placeholder="https://…"
                className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => draft.trim() && save("image", draft.trim())}
                disabled={saving || !draft.trim()}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {saving ? "Saving…" : "Apply"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
