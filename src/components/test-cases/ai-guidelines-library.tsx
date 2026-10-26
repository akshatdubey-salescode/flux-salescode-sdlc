"use client";

import { useCallback, useEffect, useState } from "react";
import { RiDeleteBinLine, RiLoader4Line, RiRefreshLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AiStatusPanel } from "./ai-status-panel";
import { GoogleReaderPanel } from "./google-reader-panel";
import type { GuidelineView } from "@/lib/test-cases/ai-review/knowledge";

type ProjectOption = { id: string; name: string; key: string };

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "never";
const json = { "Content-Type": "application/json" };

/**
 * The AI review's guidelines library (admins). Pages marked "General" are used in every project's reviews;
 * the others are used only in the projects that select them (on each project's AI Review tab).
 */
export function AiGuidelinesLibrary({ aiConfigured }: { aiConfigured: boolean }) {
  const [pages, setPages] = useState<GuidelineView[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [readWith, setReadWith] = useState("");
  const [general, setGeneral] = useState(false);
  const [withChildren, setWithChildren] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/test-cases/ai-guidelines", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not load the library.");
      setPages([]);
      return;
    }
    setPages(data.pages);
    setProjects(data.projects);
    setReadWith((cur) => cur || data.projects[0]?.id || "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(key: string, fn: () => Promise<Response>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusy(key);
    setError(null);
    setAdded(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "That didn't work.");
      else await load();
      return { ok: res.ok, data };
    } catch {
      setError("Network error. Try again.");
      return { ok: false, data: {} };
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <GoogleReaderPanel />
      <AiStatusPanel />
      <div>
        <h1 className="text-base font-semibold text-foreground">AI review guidelines</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The Confluence pages the AI reads before it reviews test cases: testing standards, the detailed flows of the code bases, module and dependency maps.
          Pages marked <b>General</b>{" "}
          are used in every project. Other pages are used only in the projects that select them (each project&apos;s AI Review tab).
          Flux reads the pages and keeps a copy; the AI never browses Confluence itself.
        </p>
        {!aiConfigured && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            The AI review is not switched on yet (no API key is configured). Pages added now will be used once it is.
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">The text of these pages is sent to the AI provider (MiniMax) with reviews. Only add pages that are fine to share with them.</p>
      </div>

      <form
        className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!url.trim() || !readWith) return;
          const { ok, data } = await call("add", () => fetch("/api/test-cases/ai-guidelines", { method: "POST", headers: json, body: JSON.stringify({ url, readWithProjectId: readWith, isGeneral: general, includeChildren: withChildren }) }));
          if (ok) {
            const addedN = (data.added as unknown[] | undefined)?.length ?? 0;
            const there = (data.alreadyThere as string[] | undefined)?.length ?? 0;
            const failed = (data.failed as { title: string; error: string }[] | undefined) ?? [];
            setAdded(
              `Added ${addedN} page${addedN === 1 ? "" : "s"}${there ? `, ${there} already in the library` : ""}${failed.length ? `, ${failed.length} could not be read (${failed.slice(0, 2).map((f) => `${f.title}: ${f.error}`).join("; ")})` : ""}.`,
            );
            setUrl("");
            setGeneral(false);
            setWithChildren(false);
          }
        }}
      >
        <p className="text-xs font-semibold text-foreground">Add a page</p>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Confluence page link (a short share link works too)"
          aria-label="Confluence page link"
          className="text-xs"
          disabled={busy === "add"}
        />
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5 text-muted-foreground">
            Read with the Jira account of
            <select
              value={readWith}
              onChange={(e) => setReadWith(e.target.value)}
              aria-label="Project whose Jira account reads the page"
              className="h-7 max-w-52 rounded-md border border-zinc-200 bg-transparent px-1.5 text-xs text-foreground dark:border-zinc-700"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
            General (use in every project)
          </label>
          <label className="inline-flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={withChildren} onChange={(e) => setWithChildren(e.target.checked)} />
            Also add all pages below it
          </label>
          <Button type="submit" size="sm" className="ml-auto" disabled={!url.trim() || !readWith || busy === "add"}>
            {busy === "add" && <RiLoader4Line className="size-3.5 animate-spin" />}
            Add page
          </Button>
        </div>
      </form>
      {added && <p className="text-xs text-emerald-700 dark:text-emerald-400">{added}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {pages === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : pages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-muted-foreground dark:border-zinc-700">
          No guidelines yet. The AI still reviews using the Jira item and the test cases, but without your standards or code base flows it can&apos;t check dependencies.
        </p>
      ) : (
        <ul className="space-y-2">
          {pages.map((p) => (
            <li key={p.id} className={cn("rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800", !p.enabled && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline" title={p.url}>
                  {p.title}
                </a>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", p.isGeneral ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400")}>
                  {p.isGeneral ? "General" : `${p.projectCount} project${p.projectCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={p.isGeneral}
                    disabled={busy === p.id}
                    onChange={(e) => call(p.id, () => fetch(`/api/test-cases/ai-guidelines/${p.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ isGeneral: e.target.checked }) }))}
                  />
                  General
                </label>
                <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={busy === p.id}
                    onChange={(e) => call(p.id, () => fetch(`/api/test-cases/ai-guidelines/${p.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ enabled: e.target.checked }) }))}
                  />
                  In use
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy === p.id}
                  onClick={() => call(p.id, () => fetch(`/api/test-cases/ai-guidelines/${p.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ refresh: true }) }))}
                >
                  {busy === p.id ? <RiLoader4Line className="size-3.5 animate-spin" /> : <RiRefreshLine className="size-3.5" />}
                  Refresh
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Remove ${p.title}`}
                  disabled={busy === p.id}
                  onClick={() => {
                    const where = p.isGeneral ? "every project" : p.projectCount > 0 ? `${p.projectCount} project${p.projectCount === 1 ? "" : "s"}` : "the library";
                    if (window.confirm(`Remove "${p.title}" from ${where}? Past reviews keep a record of what they used.`)) void call(p.id, () => fetch(`/api/test-cases/ai-guidelines/${p.id}`, { method: "DELETE" }));
                  }}
                >
                  <RiDeleteBinLine className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Version {p.version} · {Math.max(1, Math.round(p.chars / 1000))}k characters{p.truncated ? " (shortened)" : ""} · read {fmt(p.fetchedAt)}
                {p.readWith ? ` · read with ${p.readWith.name}'s Jira account` : " · reader project removed"}
              </p>
              {p.lastError && <p className="mt-0.5 text-[11px] text-destructive">Last refresh failed: {p.lastError} The earlier copy is still used.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
