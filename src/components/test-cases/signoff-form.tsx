"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiGoogleLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { withReturnTo } from "@/lib/test-cases/return-to";
import type { SignoffPreview } from "@/lib/test-cases/signoff-service";
import { invalidateTcSummaries } from "./tc-summary-cache";

type PreviewResponse = {
  sheetUrl: string | null;
  sheetTitle: string | null;
  selectedTabs: string[];
  preview: SignoffPreview | null;
  error?: string;
};

type FormError = { message: string; code?: string };

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ROLE_LABEL = { dev: "Developer", tester: "Tester" } as const;

export function SignoffForm({
  issue,
  roundId,
  roundNo,
  role,
  returnTo,
  cancelHref,
  lock,
}: {
  issue: { id: string; jiraKey: string; summary: string };
  roundId: string;
  roundNo: number;
  role: "dev" | "tester";
  /** Where the user came from; carried on to the details page after submitting. */
  returnTo: string | null;
  cancelHref: string;
  /** The item's fixed source and the tabs of the latest round, which sign-off reads. */
  lock: { source: "google_sheet" | "xlsx"; sheetUrl: string | null; tabs: string[] };
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  // The source is the item's own, so there is no choice and no link to paste.
  const mode: "sheet" | "file" = lock.source === "xlsx" ? "file" : "sheet";
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [error, setError] = useState<FormError | null>(null);

  const hasInput = mode === "sheet" ? true : file !== null;
  const preview = result?.preview ?? null;
  const readyToCommit = !!result && result.selectedTabs.length > 0 && !!preview && !preview.problem && busy === null;

  const connectHref = useMemo(() => {
    const back = typeof window === "undefined" ? "/test-cases" : window.location.pathname + window.location.search;
    return `/api/google/connect?scopes=sheets&redirectBack=${encodeURIComponent(back)}`;
  }, []);

  function resetResult() {
    setResult(null);
    setError(null);
  }

  function build(action: "preview" | "commit") {
    const fd = new FormData();
    fd.set("role", role);
    fd.set("mode", action);
    fd.set("source", mode === "sheet" ? "google_sheet" : "xlsx");
    if (mode === "file" && file) fd.set("file", file);
    return fd;
  }

  async function validate() {
    setBusy("validate");
    setError(null);
    try {
      const res = await fetch(`/api/test-cases/rounds/${roundId}/signoff`, { method: "POST", body: build("preview") });
      const data = await res.json();
      if (!res.ok) {
        setResult(null);
        setError({ message: data.error ?? "Could not read that source.", code: data.code });
        return;
      }
      setResult(data as PreviewResponse);
      if (data.error) setError({ message: data.error });
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
      const fd = build("commit");
      if (notes.trim()) fd.set("notes", notes.trim());
      const res = await fetch(`/api/test-cases/rounds/${roundId}/signoff`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? "Could not save.", code: data.code });
        setBusy(null);
        return;
      }
      // Next keeps this page's state on return, so clear it.
      setResult(null);
      setFile(null);
      setNotes("");
      invalidateTcSummaries();
      router.push(withReturnTo(data.detailUrl as string, returnTo));
    } catch {
      setError({ message: "Network error. Try again." });
      setBusy(null);
    }
  }

  const needsGoogle = error?.code === "not_connected" || error?.code === "scope_missing";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-foreground">{issue.jiraKey}</span>
          <span className="ml-2">{ROLE_LABEL[role]} sign-off · Round {roundNo}</span>
        </p>
        <h1 className="mt-1.5 text-base font-semibold text-foreground">{issue.summary}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Submit the same sheet with the {role === "dev" ? "DEV STATUS" : "TESTER / QA STATUS"} column filled in (Passed, Failed or
          Blocked) and your remarks. Results are matched to the approved round by test case ID, and a new submission replaces your earlier
          one.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">1. Results sheet</h2>
        <p className="text-xs text-muted-foreground">
          Tabs read: <span className="font-medium text-foreground">{lock.tabs.join(", ") || "the item's tabs"}</span>
        </p>
        {mode === "sheet" ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">This item&apos;s Google Sheet (the same one the test cases came from)</Label>
            <a
              href={lock.sheetUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-zinc-200 bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted dark:border-zinc-700"
            >
              <RiGoogleLine className="size-3.5 shrink-0" />
              <span className="truncate">{lock.sheetUrl}</span>
            </a>
            <p className="text-[11px] text-muted-foreground">Fill your status column in the sheet, then read it here. Flux reads the sheet as you.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Excel file (.xlsx, up to 4 MB)</Label>
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
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>Choose file…</Button>
              <span className="truncate text-xs text-muted-foreground">{file ? file.name : "No file chosen"}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => validate()} disabled={!hasInput || busy !== null}>
            {busy === "validate" ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
            {busy === "validate" ? "Reading…" : result ? "Validate again" : "Validate"}
          </Button>
          {result?.sheetTitle && <span className="text-xs text-muted-foreground">Sheet: {result.sheetTitle}</span>}
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            <RiErrorWarningLine className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1.5">
              <p>{error.message}</p>
              {needsGoogle && (
                <a href={connectHref} className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-transparent">
                  <RiGoogleLine className="size-3.5" />
                  {error.code === "scope_missing" ? "Allow reading Google Sheets" : "Connect Google"}
                </a>
              )}
            </div>
          </div>
        )}

        {preview && <PreviewBox preview={preview} />}
      </section>

      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-foreground">2. Notes <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Build / environment tested, known gaps…" aria-label="Sign-off notes" className="min-h-16 text-xs" />
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link href={cancelHref} className="text-xs text-muted-foreground hover:text-foreground hover:underline">Cancel</Link>
        <div className="flex items-center gap-3">
          {!readyToCommit && busy === null && (
            <span className="text-[11px] text-muted-foreground">
              {!preview ? "Validate the sheet first." : (preview.problem ?? "")}
            </span>
          )}
          <Button type="button" onClick={commit} disabled={!readyToCommit}>
            {busy === "commit" ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
            {busy === "commit" ? "Saving…" : `Submit ${ROLE_LABEL[role].toLowerCase()} sign-off`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewBox({ preview }: { preview: SignoffPreview }) {
  const { counts } = preview;
  const chips: [string, number, string][] = [
    ["Passed", counts.pass, "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"],
    ["Failed", counts.fail, "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"],
    ["Blocked", counts.blocked, "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"],
    ["Not run", counts.not_run, "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"],
  ];
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
      <p className="inline-flex items-center gap-1 font-semibold text-foreground">
        {preview.problem ? <RiErrorWarningLine className="size-4 text-red-600" /> : <RiCheckboxCircleLine className="size-4 text-emerald-600" />}
        {preview.total} test cases in the approved round
      </p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([label, n, cls]) => (
          <span key={label} className={cn("rounded-full border px-2 py-0.5 text-[11px]", cls)}>
            {label} <span className="font-semibold tabular-nums">{n}</span>
          </span>
        ))}
      </div>
      {preview.meta && <p className="text-[11px] text-muted-foreground">Tester / date / build in sheet: {preview.meta}</p>}
      {preview.problem && <p className="text-[11px] font-medium text-red-600">{preview.problem}</p>}
      {preview.missing.length > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {preview.missing.length} approved test case{preview.missing.length === 1 ? " is" : "s are"} missing from this sheet and will be recorded as
          not run: {preview.missing.slice(0, 8).join(", ")}{preview.missing.length > 8 ? "…" : ""}
        </p>
      )}
      {preview.unmatched.length > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {preview.unmatched.length} test case{preview.unmatched.length === 1 ? "" : "s"} in the sheet are not in the approved round and are ignored:{" "}
          {preview.unmatched.slice(0, 8).join(", ")}{preview.unmatched.length > 8 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
