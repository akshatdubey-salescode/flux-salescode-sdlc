"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GuidelineView } from "@/lib/test-cases/ai-review/knowledge";

/**
 * Project tab (admins): which of the central guidelines apply to this project's AI reviews. General pages apply to
 * every project and can't be turned off here; the rest are selected per project.
 */
export function AiProjectGuidelines({ projectId, aiConfigured }: { projectId: string; aiConfigured: boolean }) {
  const [pages, setPages] = useState<GuidelineView[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/test-cases/ai-guidelines?projectId=${projectId}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not load the guidelines.");
      setPages([]);
      return;
    }
    setPages(data.pages);
    setSaved(new Set<string>(data.selected));
    setPicked(new Set<string>(data.selected));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const general = (pages ?? []).filter((p) => p.isGeneral);
  const optional = (pages ?? []).filter((p) => !p.isGeneral);
  const dirty = picked.size !== saved.size || [...picked].some((id) => !saved.has(id));

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/test-cases/ai-guidelines/projects/${projectId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guidelineIds: [...picked] }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Could not save.");
      else {
        setSaved(new Set(picked));
        setNote("Saved. The next AI review of this project uses these.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">AI review guidelines for this project</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The AI reads these Confluence pages before reviewing this project&apos;s test cases. General pages apply to every project; choose which of the others
          apply here. Pages are managed in the{" "}
          <Link href="/admin/ai-guidelines" className="text-primary hover:underline">
            guidelines library
          </Link>
          .
        </p>
        {!aiConfigured && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            The AI review is not switched on yet (no API key is configured). These choices will be used once it is.
          </p>
        )}
      </div>

      {pages === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : pages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-muted-foreground dark:border-zinc-700">
          The library is empty. Add pages in the guidelines library first.
        </p>
      ) : (
        <>
          <Group title="Apply to every project">
            {general.length === 0 ? (
              <p className="text-xs text-muted-foreground">No general pages.</p>
            ) : (
              general.map((p) => <Row key={p.id} page={p} checked locked />)
            )}
          </Group>
          <Group title="Choose for this project">
            {optional.length === 0 ? (
              <p className="text-xs text-muted-foreground">No other pages in the library.</p>
            ) : (
              optional.map((p) => (
                <Row
                  key={p.id}
                  page={p}
                  checked={picked.has(p.id)}
                  onChange={(on) =>
                    setPicked((cur) => {
                      const next = new Set(cur);
                      if (on) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
              ))
            )}
          </Group>
          {optional.length > 0 && (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={save} disabled={!dirty || busy}>
                {busy && <RiLoader4Line className="size-3.5 animate-spin" />}
                Save
              </Button>
              {dirty && !busy && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set(saved))}>
                  Reset
                </Button>
              )}
              {note && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">{note}</span>}
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">{title}</h3>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Row({ page, checked, locked, onChange }: { page: GuidelineView; checked: boolean; locked?: boolean; onChange?: (on: boolean) => void }) {
  return (
    <li className={cn("flex items-start gap-3 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800", !page.enabled && "opacity-60")}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={locked ? `${page.title} (applies to every project)` : `Use ${page.title} in this project's reviews`}
      />
      <div className="min-w-0 flex-1">
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-primary hover:underline" title={page.url}>
          {page.title}
        </a>
        <p className="text-[11px] text-muted-foreground">
          {Math.max(1, Math.round(page.chars / 1000))}k characters{!page.enabled ? " · switched off in the library, not used" : ""}
          {page.lastError ? " · last refresh failed" : ""}
        </p>
      </div>
    </li>
  );
}
