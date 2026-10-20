"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RiCheckboxCircleLine,
  RiDownload2Line,
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
import { withReturnTo } from "@/lib/test-cases/return-to";
import {
  MAX_TABS_PER_ITEM,
  TC_CATEGORY_LABELS,
  TC_POLARITY_LABELS,
  type TcCategory,
  type TcPolarity,
  type TcReviewerState,
} from "@/lib/test-cases/values";
import type { Preview } from "@/lib/test-cases/preview";
import type { SourceTabInfo } from "@/lib/test-cases/source";
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
  tabs: SourceTabInfo[];
  selectedTabs: string[];
  missingPrevious: string[];
  preview: Preview | null;
};

/** What the item is already tied to (set by its first submission). */
export type FormLock = {
  source: "google_sheet" | "xlsx";
  sheetUrl: string | null;
  /** The latest round's snapshot, for "download current workbook" (Excel items). */
  currentFile: { id: string; fileName: string } | null;
};

export type PreviousReviewer = Reviewer & { state: TcReviewerState };

type FormError = { message: string; code?: string };

const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function SubmissionForm({
  issue,
  nextRound,
  committerEmail,
  initialReviewers,
  returnTo,
  cancelHref,
  lock,
}: {
  issue: IssueInfo;
  nextRound: number;
  committerEmail: string;
  initialReviewers: PreviousReviewer[];
  /** Where the user came from (Delivery / Sprint tab); carried on to the details page after commit. */
  returnTo: string | null;
  /** Where Cancel goes. */
  cancelHref: string;
  /** Null for a first submission; otherwise the source this item is fixed to. */
  lock: FormLock | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  // A resubmission keeps the item's source: the choice is hidden, not offered.
  const [mode, setMode] = useState<"sheet" | "file">(lock ? (lock.source === "xlsx" ? "file" : "sheet") : "sheet");
  const [sheetUrl, setSheetUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<InspectResponse | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>(initialReviewers.map(({ email, name }) => ({ email, name })));
  // The tabs the user ticked, once they have ticked any; before that the server's choice is used.
  const [ticked, setTicked] = useState<string[] | null>(null);
  const [validatedTabs, setValidatedTabs] = useState<string>("");
  const [tabFilter, setTabFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [error, setError] = useState<FormError | null>(null);

  const lockedSheet = lock?.source === "google_sheet";
  const hasInput = mode === "sheet" ? lockedSheet || sheetUrl.trim().length > 0 : file !== null;
  const preview = result?.preview ?? null;
  const selectedTabs = ticked ?? result?.selectedTabs ?? [];
  // The preview describes the tabs that were read; ticking another tab makes it stale until validated again.
  const previewCurrent = validatedTabs === selectedTabs.join("\u0000");
  const readyToCommit =
    selectedTabs.length > 0 && preview?.ok === true && preview.canCommit && previewCurrent && reviewers.length > 0 && busy === null;

  const connectHref = useMemo(() => {
    const back = typeof window === "undefined" ? "/test-cases/new" : window.location.pathname + window.location.search;
    return `/api/google/connect?scopes=sheets&redirectBack=${encodeURIComponent(back)}`;
  }, []);

  function resetResult() {
    setResult(null);
    setTicked(null);
    setValidatedTabs("");
    setError(null);
  }

  function sourceFields(fd: FormData) {
    fd.set("issueId", issue.id);
    // A locked sheet is read from the item's own link, which the server supplies.
    if (mode === "sheet") {
      if (!lockedSheet) fd.set("sheetUrl", sheetUrl.trim());
    } else if (file) {
      fd.set("file", file);
    }
  }

  function toggleTab(title: string) {
    const current = ticked ?? result?.selectedTabs ?? [];
    if (current.includes(title)) setTicked(current.filter((t) => t !== title));
    else if (current.length < MAX_TABS_PER_ITEM) setTicked([...current, title]);
  }

  async function validate(tabs?: string[] | null) {
    setBusy("validate");
    setError(null);
    try {
      const fd = new FormData();
      sourceFields(fd);
      if (tabs) fd.set("tabs", JSON.stringify(tabs));
      const res = await fetch("/api/test-cases/inspect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setResult(null);
        setError({ message: data.error ?? "Could not read that source.", code: data.code });
        return;
      }
      const r = data as InspectResponse;
      setResult(r);
      setTicked(r.selectedTabs);
      setValidatedTabs(r.selectedTabs.join("\u0000"));
    } catch {
      setError({ message: "Network error. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!readyToCommit) return;
    setBusy("commit");
    setError(null);
    try {
      const fd = new FormData();
      sourceFields(fd);
      fd.set("source", mode === "sheet" ? "google_sheet" : "xlsx");
      fd.set("tabs", JSON.stringify(selectedTabs));
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
      setTicked(null);
      setValidatedTabs("");
      setFile(null);
      setSheetUrl("");
      setNotes("");
      setMode(lock ? (lock.source === "xlsx" ? "file" : "sheet") : "sheet");
      invalidateTcSummaries();
      router.push(withReturnTo(data.detailUrl as string, returnTo));
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

        {!lock && (
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
        )}

        {lock && (
          <p className="text-xs text-muted-foreground">
            This item&apos;s test cases come {lockedSheet ? "from one Google Sheet" : "from an Excel workbook"}, fixed by the first submission. Edit it
            there and resubmit; extra test cases can go on its existing or new tabs.
          </p>
        )}

        {mode === "sheet" && lockedSheet ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Google Sheet for this item</Label>
            <a
              href={lock!.sheetUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-zinc-200 bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted dark:border-zinc-700"
            >
              <RiGoogleLine className="size-3.5 shrink-0" />
              <span className="truncate">{lock!.sheetUrl}</span>
              <RiExternalLinkLine className="size-3 shrink-0 opacity-60" />
            </a>
          </div>
        ) : mode === "sheet" ? (
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
            {lock?.currentFile && (
              <a
                href={`/api/test-cases/files/${lock.currentFile.id}`}
                title={lock.currentFile.fileName}
                className="mb-1 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <RiDownload2Line className="size-3.5" />
                Download current workbook
              </a>
            )}
            <Label className="text-xs text-muted-foreground">
              {lock
                ? "Upload the revised workbook (.xlsx, up to 4 MB). It becomes the item's current sheet; earlier rounds stay downloadable."
                : "Excel file (.xlsx, up to 4 MB — larger sheets: use a Google Sheet link)"}
            </Label>
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
          <Button type="button" size="sm" onClick={() => validate(ticked)} disabled={!hasInput || busy !== null}>
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

        {result && result.tabs.some((t) => !t.hidden) && (
          <TabPicker
            tabs={result.tabs.filter((t) => !t.hidden)}
            selected={selectedTabs}
            onToggle={toggleTab}
            filter={tabFilter}
            onFilter={setTabFilter}
            itemKey={issue.jiraKey}
            disabled={busy !== null}
          />
        )}

        {result && result.missingPrevious.length > 0 && (
          <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Tab{result.missingPrevious.length === 1 ? "" : "s"} used in the earlier round {result.missingPrevious.length === 1 ? "is" : "are"} no longer in this
            source: {result.missingPrevious.join(", ")}. {result.missingPrevious.length === 1 ? "Its" : "Their"} test cases will not be part of this round.
          </p>
        )}

        {result && selectedTabs.length > 0 && !previewCurrent && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Tab selection changed. Validate again to preview it.</p>
        )}

        {preview && previewCurrent && <PreviewPanel preview={preview} />}
      </section>

      {/* 2. Reviewers */}
      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">2. Reviewers</h2>
        <p className="text-xs text-muted-foreground">
          Assign who reviews and approves these test cases. At least one is required, and it can&apos;t be you.
        </p>
        <ReviewerPicker value={reviewers} onChange={setReviewers} disabledEmail={committerEmail} />
        {initialReviewers.length > 0 && <CarryOverHint previous={initialReviewers} current={reviewers} />}
      </section>

      {/* 3. Notes */}
      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">3. Notes <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Anything the reviewers should know…" className="min-h-16 text-xs" />
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link href={cancelHref} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Cancel
        </Link>
        <div className="flex items-center gap-3">
          {!readyToCommit && busy === null && (
            <span className="text-[11px] text-muted-foreground">
              {!preview?.ok
                ? "Validate the test cases first."
                : !preview.canCommit
                  ? "Fix the errors above first."
                  : !previewCurrent
                    ? "Validate the selected tabs first."
                  : selectedTabs.length === 0
                    ? "Choose at least one tab."
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

function TabPicker({
  tabs,
  selected,
  onToggle,
  filter,
  onFilter,
  itemKey,
  disabled,
}: {
  tabs: SourceTabInfo[];
  selected: string[];
  onToggle: (title: string) => void;
  filter: string;
  onFilter: (v: string) => void;
  itemKey: string;
  disabled: boolean;
}) {
  const shown = tabs.filter((t) => !filter.trim() || t.title.toLowerCase().includes(filter.trim().toLowerCase()) || selected.includes(t.title));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">
          Tabs that hold {itemKey}&apos;s test cases — tick every tab that belongs to this item ({selected.length} of at most {MAX_TABS_PER_ITEM})
        </Label>
        {tabs.length > 8 && (
          <Input value={filter} onChange={(e) => onFilter(e.target.value)} placeholder="Filter tabs…" className="h-7 w-44 text-xs" aria-label="Filter tabs" />
        )}
      </div>
      <ul className="max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
        {shown.map((t) => {
          const on = selected.includes(t.title);
          const atLimit = !on && selected.length >= MAX_TABS_PER_ITEM;
          return (
            <li key={t.title}>
              <label className={cn("flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50", atLimit && "cursor-not-allowed opacity-50")}>
                <input type="checkbox" checked={on} disabled={disabled || atLimit} onChange={() => onToggle(t.title)} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate" title={t.title}>{t.title}</span>
                {t.previous && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">in earlier round</span>}
                {t.suggested && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">suggested</span>}
              </label>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2.5 py-2 text-muted-foreground">No tab matches.</li>}
      </ul>
    </div>
  );
}

/** What happens to each reviewer's earlier decision when this round is committed. */
function CarryOverHint({ previous, current }: { previous: PreviousReviewer[]; current: Reviewer[] }) {
  const prev = new Map(previous.map((p) => [p.email.toLowerCase(), p]));
  const label = (r: Reviewer) => r.name ?? r.email;
  const stays: string[] = [];
  const redo: string[] = [];
  const fresh: string[] = [];
  for (const r of current) {
    const p = prev.get(r.email.toLowerCase());
    if (!p) fresh.push(label(r));
    else if (p.state === "approved" || p.state === "overridden") stays.push(label(r));
    else if (p.state === "changes_requested" || p.state === "re_review") redo.push(label(r));
    else fresh.push(label(r));
  }
  if (stays.length + redo.length === 0) return null;
  return (
    <ul className="space-y-0.5 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
      {stays.length > 0 && <li>Earlier approval stands: <span className="font-medium text-foreground">{stays.join(", ")}</span></li>}
      {redo.length > 0 && <li>Asked for changes, will be asked to re-review: <span className="font-medium text-foreground">{redo.join(", ")}</span></li>}
      {fresh.length > 0 && <li>Not reviewed yet: <span className="font-medium text-foreground">{fresh.join(", ")}</span></li>}
    </ul>
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
  const multi = preview.tabs.length > 1;
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
          <RiCheckboxCircleLine className="size-4 text-emerald-600" />
          {preview.caseCount} test case{preview.caseCount === 1 ? "" : "s"} found{multi ? ` across ${preview.tabs.length} tabs` : ""}
        </span>
        {preview.errorCount > 0 && <span className="font-semibold text-red-600">{preview.errorCount} error{preview.errorCount === 1 ? "" : "s"}</span>}
        {preview.warningCount > 0 && <span className="font-semibold text-amber-600">{preview.warningCount} warning{preview.warningCount === 1 ? "" : "s"}</span>}
      </div>

      {multi && (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-muted-foreground dark:border-zinc-800">
              {["Tab", "Test cases", "Sections", "Errors"].map((h) => (
                <th key={h} className="px-2 py-1 font-semibold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.tabs.map((t) => (
              <tr key={t.title} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="max-w-[260px] truncate px-2 py-1" title={t.title}>{t.title}</td>
                <td className="px-2 py-1 tabular-nums">{t.caseCount}</td>
                <td className="px-2 py-1 tabular-nums">{t.sections.length}</td>
                <td className={cn("px-2 py-1 tabular-nums", t.errorCount > 0 && "font-semibold text-red-600")}>{t.errorCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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

      {preview.tabs.some((t) => t.sections.length > 1) && (
        <p className="text-[11px] text-muted-foreground">
          Some tabs have several sections whose IDs restart, so results are matched by tab + section + ID.
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
              {multi ? `${i.tab}: ` : ""}
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
              {[...(multi ? ["Tab"] : []), "ID", "Title", "Category", "Polarity", "Priority", "Dev", "Tester"].map((h) => (
                <th key={h} className="px-2 py-1 font-semibold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={`${r.tab}/${r.section ?? ""}/${r.tcId}`} className="border-b border-zinc-100 dark:border-zinc-800/60">
                {multi && <td className="max-w-[120px] truncate px-2 py-1" title={r.tab}>{r.tab}</td>}
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
