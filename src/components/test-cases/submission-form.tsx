"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiFileExcel2Line,
  RiGoogleLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ReviewerPicker, type Reviewer } from "./reviewer-picker";
import { TC_CATEGORY_LABELS, TC_POLARITY_LABELS, type TcCategory, type TcPolarity } from "@/lib/test-cases/values";
import type { Preview } from "@/lib/test-cases/preview";
import { invalidateTcSummaries } from "./tc-summary-cache";

type IssueInfo = {
  id: string;
  jiraKey: string;
  summary: string;
  issueType: string;
  status: string;
  projectName: string;
  jiraBaseUrl: string;
};

type InspectResponse = {
  source: "google_sheet" | "xlsx";
  sheetUrl: string | null;
  sheetTitle: string | null;
  tabs: { title: string; hidden: boolean; suggested: boolean }[];
  selectedTab: string | null;
  preview: Preview | null;
};

type FormError = { message: string; code?: string };

const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function SubmissionForm({
  issue,
  nextRound,
  committerEmail,
  initialReviewers,
}: {
  issue: IssueInfo;
  nextRound: number;
  committerEmail: string;
  initialReviewers: Reviewer[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"sheet" | "file">("sheet");
  const [sheetUrl, setSheetUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<InspectResponse | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>(initialReviewers);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [error, setError] = useState<FormError | null>(null);

  const hasInput = mode === "sheet" ? sheetUrl.trim().length > 0 : file !== null;
  const preview = result?.preview ?? null;
  const readyToCommit =
    !!result?.selectedTab && preview?.ok === true && preview.canCommit && reviewers.length > 0 && busy === null;

  const connectHref = useMemo(() => {
    const back = typeof window === "undefined" ? "/test-cases/new" : window.location.pathname + window.location.search;
    return `/api/google/connect?scopes=sheets&redirectBack=${encodeURIComponent(back)}`;
  }, []);

  function resetResult() {
    setResult(null);
    setError(null);
  }

  function sourceFields(fd: FormData) {
    fd.set("issueId", issue.id);
    if (mode === "sheet") fd.set("sheetUrl", sheetUrl.trim());
    else if (file) fd.set("file", file);
  }

  async function validate(tab?: string | null) {
    setBusy("validate");
    setError(null);
    try {
      const fd = new FormData();
      sourceFields(fd);
      if (tab) fd.set("tab", tab);
      const res = await fetch("/api/test-cases/inspect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setResult(null);
        setError({ message: data.error ?? "Could not read that source.", code: data.code });
        return;
      }
      setResult(data as InspectResponse);
    } catch {
      setError({ message: "Network error. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!readyToCommit || !result?.selectedTab) return;
    setBusy("commit");
    setError(null);
    try {
      const fd = new FormData();
      sourceFields(fd);
      fd.set("source", mode === "sheet" ? "google_sheet" : "xlsx");
      fd.set("tab", result.selectedTab);
      fd.set("reviewers", JSON.stringify(reviewers));
      if (notes.trim()) fd.set("notes", notes.trim());
      const res = await fetch("/api/test-cases/commit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? "Could not save.", code: data.code });
        setBusy(null);
        return;
      }
      // Next keeps this page's state when you come back to it, so clear it:
      // otherwise "New round" would reopen with the file/preview just committed.
      setResult(null);
      setFile(null);
      setSheetUrl("");
      setNotes("");
      setMode("sheet");
      invalidateTcSummaries();
      router.push(data.detailUrl as string);
    } catch {
      setError({ message: "Network error. Try again." });
      setBusy(null);
    }
  }

  const needsGoogle = error?.code === "not_connected" || error?.code === "scope_missing";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Issue */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <a
            href={`${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-foreground hover:underline"
          >
            {issue.jiraKey}
            <RiExternalLinkLine className="size-3 opacity-60" />
          </a>
          <span>{issue.issueType}</span>
          <span>·</span>
          <span>{issue.status}</span>
          <span>·</span>
          <span>{issue.projectName}</span>
        </div>
        <h1 className="mt-1.5 text-base font-semibold text-foreground">{issue.summary}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {nextRound === 1 ? "This will be the first submission" : `This will be Round ${nextRound}; earlier rounds stay available`} for this issue.
        </p>
      </section>

      {/* 1. Source */}
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">1. Test cases</h2>

        <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800" role="tablist">
          {(
            [
              ["sheet", "Google Sheet link", RiGoogleLine],
              ["file", "Excel file", RiFileExcel2Line],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                resetResult();
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition-colors",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {mode === "sheet" ? (
          <div className="space-y-1">
            <Label htmlFor="sheet-url" className="text-xs text-muted-foreground">
              Link to the Google Sheet (a link to the specific tab selects it)
            </Label>
            <Input
              id="sheet-url"
              value={sheetUrl}
              onChange={(e) => {
                setSheetUrl(e.target.value);
                resetResult();
              }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Flux reads the sheet as you, so you need access to it. On commit, a snapshot of the tab is saved and the live
              link is kept alongside it.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Excel file (.xlsx, up to 4 MB — larger sheets: use a Google Sheet link)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  resetResult();
                  if (f && f.size > MAX_FILE_BYTES) {
                    setFile(null);
                    setError({ message: "That file is larger than 4 MB. Share it as a Google Sheet link instead." });
                    return;
                  }
                  setFile(f);
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Choose file…
              </Button>
              <span className="truncate text-xs text-muted-foreground">{file ? file.name : "No file chosen"}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => validate(result?.selectedTab)} disabled={!hasInput || busy !== null}>
            {busy === "validate" ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
            {busy === "validate" ? "Reading…" : result ? "Validate again" : "Validate"}
          </Button>
          {result?.sheetTitle && <span className="text-xs text-muted-foreground">Sheet: {result.sheetTitle}</span>}
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
          >
            <RiErrorWarningLine className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1.5">
              <p>{error.message}</p>
              {needsGoogle && (
                <a
                  href={connectHref}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-transparent"
                >
                  <RiGoogleLine className="size-3.5" />
                  {error.code === "scope_missing" ? "Allow reading Google Sheets" : "Connect Google"}
                </a>
              )}
            </div>
          </div>
        )}

        {result && result.tabs.filter((t) => !t.hidden).length > 0 && (
          <div className="space-y-1">
            <Label htmlFor="tc-tab" className="text-xs text-muted-foreground">
              Tab that holds {issue.jiraKey}&apos;s test cases
            </Label>
            <select
              id="tc-tab"
              value={result.selectedTab ?? ""}
              onChange={(e) => e.target.value && validate(e.target.value)}
              disabled={busy !== null}
              className="h-8 w-full max-w-md rounded-md border border-input bg-background px-2 text-xs"
            >
              {!result.selectedTab && <option value="">Choose a tab…</option>}
              {result.tabs
                .filter((t) => !t.hidden)
                .map((t) => (
                  <option key={t.title} value={t.title}>
                    {t.title}
                    {t.suggested ? "  (suggested)" : ""}
                  </option>
                ))}
            </select>
          </div>
        )}

        {preview && <PreviewPanel preview={preview} />}
      </section>

      {/* 2. Reviewers */}
      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">2. Reviewers</h2>
        <p className="text-xs text-muted-foreground">
          Assign who reviews and approves these test cases. At least one is required, and it can&apos;t be you.
        </p>
        <ReviewerPicker value={reviewers} onChange={setReviewers} disabledEmail={committerEmail} />
      </section>

      {/* 3. Notes */}
      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">3. Notes <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Anything the reviewers should know…" className="min-h-16 text-xs" />
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link href={`/test-cases/${issue.id}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Cancel
        </Link>
        <div className="flex items-center gap-3">
          {!readyToCommit && busy === null && (
            <span className="text-[11px] text-muted-foreground">
              {!preview?.ok
                ? "Validate the test cases first."
                : !preview.canCommit
                  ? "Fix the errors above first."
                  : !result?.selectedTab
                    ? "Choose a tab."
                    : reviewers.length === 0
                      ? "Add at least one reviewer."
                      : ""}
            </span>
          )}
          <Button type="button" onClick={commit} disabled={!readyToCommit}>
            {busy === "commit" ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
            {busy === "commit" ? "Saving…" : `Commit Round ${nextRound}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: Preview }) {
  if (!preview.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
        {preview.error}
      </div>
    );
  }
  const categories = Object.entries(preview.categorySplit) as [TcCategory, number][];
  const polarities = Object.entries(preview.polaritySplit) as [TcPolarity, number][];
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
          <RiCheckboxCircleLine className="size-4 text-emerald-600" />
          {preview.caseCount} test case{preview.caseCount === 1 ? "" : "s"} found
        </span>
        <span className="text-muted-foreground">layout {preview.layout}</span>
        {preview.errorCount > 0 && <span className="font-semibold text-red-600">{preview.errorCount} error{preview.errorCount === 1 ? "" : "s"}</span>}
        {preview.warningCount > 0 && <span className="font-semibold text-amber-600">{preview.warningCount} warning{preview.warningCount === 1 ? "" : "s"}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {polarities.map(([t, n]) => (
          <span key={t} className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] dark:border-sky-900 dark:bg-sky-950/30">
            {TC_POLARITY_LABELS[t]} <span className="font-semibold tabular-nums">{n}</span>
          </span>
        ))}
        {categories.map(([t, n]) => (
          <span key={t} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
            {TC_CATEGORY_LABELS[t]} <span className="font-semibold tabular-nums">{n}</span>
          </span>
        ))}
      </div>

      {preview.sections.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          {preview.sections.length} sections:{" "}
          {preview.sections.map((s) => `${s.title ?? `Section ${s.no}`} (${s.caseCount})`).join(" · ")}. IDs restart in each section, so
          results are matched by section + ID.
        </p>
      )}

      {preview.unmapped.length > 0 && (
        <div className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-semibold">Values that didn&apos;t match the standard lists (kept as-is / treated as Other or not run):</p>
          <ul className="mt-1 list-disc pl-4">
            {preview.unmapped.slice(0, 12).map((u) => (
              <li key={`${u.field}-${u.value}`}>
                {u.field}: &ldquo;{u.value}&rdquo; × {u.count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.issues.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
          {preview.issues.map((i, idx) => (
            <li key={idx} className={i.severity === "error" ? "text-red-600" : "text-amber-700 dark:text-amber-400"}>
              {i.row ? `Row ${i.row}: ` : ""}
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-muted-foreground dark:border-zinc-800">
              {["ID", "Title", "Category", "Polarity", "Priority", "Dev", "Tester"].map((h) => (
                <th key={h} className="px-2 py-1 font-semibold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={`${r.section ?? ""}/${r.tcId}`} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="px-2 py-1 font-mono">{r.tcId}</td>
                <td className="max-w-[320px] truncate px-2 py-1" title={r.title}>{r.title}</td>
                <td className="px-2 py-1">{TC_CATEGORY_LABELS[r.category]}</td>
                <td className="px-2 py-1">{r.polarity ? TC_POLARITY_LABELS[r.polarity] : "—"}</td>
                <td className="px-2 py-1">{r.priority ?? "—"}</td>
                <td className="px-2 py-1">{r.devStatus || "—"}</td>
                <td className="px-2 py-1">{r.testerStatus || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.caseCount > preview.rows.length && (
          <p className="pt-1 text-[11px] text-muted-foreground">Showing the first {preview.rows.length} of {preview.caseCount}.</p>
        )}
      </div>
    </div>
  );
}
