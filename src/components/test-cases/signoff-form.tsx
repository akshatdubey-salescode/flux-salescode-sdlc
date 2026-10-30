"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiFileExcel2Line,
  RiGoogleLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { withReturnTo } from "@/lib/test-cases/return-to";
import { parseSheetUrl } from "@/lib/test-cases/sheet-url";
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
  sheetReaderEmail = null,
}: {
  /** The shared Google account Flux reads sheets with; null when none is connected (people then connect their own). */
  sheetReaderEmail?: string | null;
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
  // The result sheet can be a Google Sheet link or an Excel file whatever the item's own source is (the sign-off never
  // changes the item's source). The item's own source is just the starting choice, and its link is pre-filled.
  const [mode, setMode] = useState<"sheet" | "file">(lock.source === "xlsx" ? "file" : "sheet");
  const [sheetUrl, setSheetUrl] = useState(lock.source === "google_sheet" ? (lock.sheetUrl ?? "") : "");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  // Only the newest read counts: a slower answer for an earlier link or file is dropped.
  const readSeq = useRef(0);

  const hasInput = mode === "sheet" ? sheetUrl.trim().length > 0 : file !== null;
  const preview = result?.preview ?? null;
  const readyToCommit = !!result && result.selectedTabs.length > 0 && !!preview && !preview.problem && busy === null;

  const connectHref = useMemo(() => {
    const back = typeof window === "undefined" ? "/test-cases" : window.location.pathname + window.location.search;
    return `/api/google/connect?scopes=sheets&redirectBack=${encodeURIComponent(back)}`;
  }, []);

  function resetResult() {
    readSeq.current++;
    setBusy((b) => (b === "validate" ? null : b));
    setResult(null);
    setError(null);
  }

  function build(action: "preview" | "commit", fileOverride?: File | null) {
    const fd = new FormData();
    fd.set("role", role);
    fd.set("mode", action);
    fd.set("source", mode === "sheet" ? "google_sheet" : "xlsx");
    const chosen = fileOverride !== undefined ? fileOverride : file;
    if (mode === "file" && chosen) fd.set("file", chosen);
    if (mode === "sheet" && sheetUrl.trim()) fd.set("sheetUrl", sheetUrl.trim());
    return fd;
  }

  async function validate(fileOverride?: File | null) {
    const seq = ++readSeq.current;
    setBusy("validate");
    setError(null);
    try {
      const res = await fetch(`/api/test-cases/rounds/${roundId}/signoff`, { method: "POST", body: build("preview", fileOverride) });
      const data = await res.json();
      if (seq !== readSeq.current) return;
      if (!res.ok) {
        setResult(null);
        setError({ message: data.error ?? "Could not read that source.", code: data.code });
        return;
      }
      setResult(data as PreviewResponse);
      if (data.error) setError({ message: data.error });
    } catch {
      if (seq === readSeq.current) setError({ message: "Network error. Try again." });
    } finally {
      if (seq === readSeq.current) setBusy(null);
    }
  }

  // Pasting a link reads it by itself (after a short pause for typing); choosing a file reads it at once.
  useEffect(() => {
    if (mode !== "sheet" || !parseSheetUrl(sheetUrl)) return;
    const timer = setTimeout(() => void validate(), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validate reads the current form state; only a new link should trigger a read
  }, [sheetUrl, mode]);

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
            <Label htmlFor="signoff-sheet-url" className="text-xs text-muted-foreground">
              Link to the Google Sheet with your results{lock.source === "google_sheet" ? " (this item's own sheet is filled in)" : ""}
            </Label>
            <Input
              id="signoff-sheet-url"
              value={sheetUrl}
              onChange={(e) => {
                setSheetUrl(e.target.value);
                resetResult();
              }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              It must have the tab{lock.tabs.length === 1 ? "" : "s"} {lock.tabs.map((t) => `"${t}"`).join(", ") || "of the approved round"} with the same Test Case IDs. Fill your status column in the sheet, then paste the link; it is read by itself.{" "}
              {sheetReaderEmail ? `Flux reads the sheet as ${sheetReaderEmail}: share it with your Salescode domain or that address.` : "Flux reads the sheet as you."}
            </p>
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
                  if (f) void validate(f);
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>Choose file…</Button>
              <span className="truncate text-xs text-muted-foreground">{file ? file.name : "No file chosen"}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => void validate()} disabled={!hasInput || busy !== null}>
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
      {preview.scope && <p className="text-[11px] text-muted-foreground">Scope of this round: {preview.scope}</p>}
      <OtherRoleNote preview={preview} />
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([label, n, cls]) => (
          <span key={label} className={cn("rounded-full border px-2 py-0.5 text-[11px]", cls)}>
            {label} <span className="font-semibold tabular-nums">{n}</span>
          </span>
        ))}
      </div>
      {preview.meta && <p className="text-[11px] text-muted-foreground">Tester / date / build in sheet: {preview.meta}</p>}
      {preview.problem && <p className="text-[11px] font-medium text-red-600">{preview.problem}</p>}
      {preview.moved > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {preview.moved} test case{preview.moved === 1 ? " is" : "s are"} on a different row than when submitted (rows were inserted or removed); matched by ID.
        </p>
      )}
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


/** The other role's sign-off, if any: it stays as recorded and its results are added to the saved sheet. */
function OtherRoleNote({ preview }: { preview: SignoffPreview }) {
  const me = ROLE_LABEL[preview.role].toLowerCase();
  const other = ROLE_LABEL[preview.role === "dev" ? "tester" : "dev"].toLowerCase();
  const o = preview.otherRole;
  if (!o) {
    return <p className="text-[11px] text-muted-foreground">No {other} sign-off yet. You can sign off first; the {other}&apos;s results are added when they sign off.</p>;
  }
  return (
    <p className="rounded-md bg-emerald-50 p-2 text-[11px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
      The {other} already signed off ({o.by}, {o.label}): {o.pass} passed, {o.fail} failed, {o.blocked} blocked, {o.notRun} not run. That sign-off stays as it is, and its results are written into the {other} status column of the sheet saved with your {me} sign-off.
    </p>
  );
}
