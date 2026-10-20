"use client";

import { useEffect, useMemo, useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine, RiChat3Line, RiSearchLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { normalizeResult } from "@/lib/test-cases/normalize";
import { TC_CATEGORY_LABELS, TC_POLARITY_LABELS, type TcCategory, type TcPolarity, type TcResult } from "@/lib/test-cases/values";
import type { CaseDetail, CaseView } from "@/lib/test-cases/service";
import type { CommentView } from "@/lib/test-cases/review-service";
import { CommentThread, type Viewer } from "./comment-thread";

const RESULT_STYLE: Record<TcResult, string> = {
  pass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  fail: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  blocked: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  not_run: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function StatusPill({ raw }: { raw: string }) {
  if (!raw.trim()) return <span className="text-muted-foreground/40">—</span>;
  const r = normalizeResult(raw).value;
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", RESULT_STYLE[r])}>{raw}</span>;
}

const PAGE_SIZE = 100;

export type ReviewContext = {
  roundId: string;
  isLatest: boolean;
  comments: CommentView[];
  viewer: Viewer;
  reviewers: { email: string }[];
  committerEmail: string;
};

export function CasesTable({ cases, review }: { cases: CaseView[]; review: ReviewContext }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [section, setSection] = useState<string>("all");
  const [tab, setTab] = useState<string>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Big items have hundreds of cases: draw a page at a time (filters still search all of them).
  const [limit, setLimit] = useState(PAGE_SIZE);

  const categories = useMemo(() => [...new Set(cases.map((c) => c.category))], [cases]);
  const tabs = useMemo(() => [...new Set(cases.map((c) => c.sheetTab))].filter(Boolean), [cases]);
  const sections = useMemo(() => [...new Set(cases.map((c) => c.section ?? ""))].filter(Boolean), [cases]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter(
      (c) =>
        (category === "all" || c.category === category) &&
        (section === "all" || (c.section ?? "") === section) &&
        (tab === "all" || c.sheetTab === tab) &&
        (!q || c.tcCode.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)),
    );
  }, [cases, query, category, section, tab]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <RiSearchLine size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }}
            placeholder="Search ID or title…"
            className="h-7 w-56 rounded border border-input bg-background pl-7 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setLimit(PAGE_SIZE); }}
          className="h-7 rounded border border-input bg-background px-2 text-xs"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((t) => (
            <option key={t} value={t}>{TC_CATEGORY_LABELS[t as TcCategory] ?? t}</option>
          ))}
        </select>
        {tabs.length > 1 && (
          <select
            value={tab}
            onChange={(e) => { setTab(e.target.value); setLimit(PAGE_SIZE); }}
            className="h-7 max-w-[220px] rounded border border-input bg-background px-2 text-xs"
            aria-label="Filter by tab"
          >
            <option value="all">All tabs</option>
            {tabs.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        {sections.length > 1 && (
          <select
            value={section}
            onChange={(e) => { setSection(e.target.value); setLimit(PAGE_SIZE); }}
            className="h-7 max-w-[220px] rounded border border-input bg-background px-2 text-xs"
            aria-label="Filter by section"
          >
            <option value="all">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <span className="text-[11px] text-muted-foreground">{Math.min(limit, rows.length)} shown of {rows.length}{rows.length !== cases.length ? ` matching (${cases.length} total)` : ""}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[820px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
              {["", "ID", "Title", "Category", "Polarity", "Priority", "Severity", "Dev (sheet)", "Tester (sheet)"].map((h, i) => (

                <th key={i} className="px-3 py-2 font-semibold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No test cases match.</td></tr>
            ) : (
              rows.slice(0, limit).map((c) => {
                const expanded = open.has(c.id);
                return (
                  <FragmentRow key={c.id} c={c} expanded={expanded} onToggle={() => toggle(c.id)} review={review} showTab={tabs.length > 1} />
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            className="h-7 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Show {Math.min(PAGE_SIZE, rows.length - limit)} more ({rows.length - limit} remaining)
          </button>
          <button type="button" onClick={() => setLimit(rows.length)} className="text-xs text-primary hover:underline">
            Show all
          </button>
        </div>
      )}
    </div>
  );
}

// Long text is loaded when a row is first expanded and kept for the life of the page.
const detailCache = new Map<string, CaseDetail>();

function useCaseDetail(caseId: string, wanted: boolean): { detail: CaseDetail | null; error: boolean } {
  const [state, setState] = useState<{ detail: CaseDetail | null; error: boolean }>(() => ({ detail: detailCache.get(caseId) ?? null, error: false }));
  useEffect(() => {
    if (!wanted || detailCache.has(caseId)) return;
    let live = true;
    fetch(`/api/test-cases/cases/${caseId}`)
      .then((r) => (r.ok ? (r.json() as Promise<CaseDetail>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        detailCache.set(caseId, d);
        if (live) setState({ detail: d, error: false });
      })
      .catch(() => live && setState({ detail: null, error: true }));
    return () => {
      live = false;
    };
  }, [caseId, wanted]);
  return { detail: state.detail ?? detailCache.get(caseId) ?? null, error: state.error };
}

function FragmentRow({
  c,
  expanded,
  onToggle,
  review,
  showTab,
}: {
  c: CaseView;
  expanded: boolean;
  onToggle: () => void;
  review: ReviewContext;
  showTab: boolean;
}) {
  const { detail, error } = useCaseDetail(c.id, expanded);
  const own = review.comments.filter((x) => x.caseId === c.id);
  const open = own.filter((x) => x.kind === "comment" && !x.resolved).length;
  return (
    <>
      <tr className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/20" onClick={onToggle}>
        <td className="w-6 px-2 py-2 text-muted-foreground">
          {expanded ? <RiArrowDownSLine size={14} /> : <RiArrowRightSLine size={14} />}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span className="font-mono">{c.tcCode}</span>
          {showTab && c.sheetTab && <span className="block max-w-[150px] truncate text-[10px] font-medium text-sky-700 dark:text-sky-300" title={c.sheetTab}>{c.sheetTab}</span>}
          {c.section && <span className="block max-w-[150px] truncate text-[10px] text-muted-foreground" title={c.section}>{c.section}</span>}
        </td>
        <td className="max-w-[360px] px-3 py-2">
          <span className="line-clamp-2">{c.title || <span className="text-muted-foreground">—</span>}</span>
          {own.length > 0 && (
            <span
              className={cn(
                "mt-0.5 inline-flex items-center gap-1 text-[10px]",
                open > 0 ? "font-semibold text-amber-600" : "text-muted-foreground",
              )}
            >
              <RiChat3Line className="size-3" />
              {open > 0 ? `${open} open` : `${own.length} comment${own.length === 1 ? "" : "s"}`}
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2">{TC_CATEGORY_LABELS[c.category as TcCategory] ?? c.category}</td>
        <td className="whitespace-nowrap px-3 py-2">{c.polarity ? TC_POLARITY_LABELS[c.polarity as TcPolarity] : "—"}</td>
        <td className="px-3 py-2">{c.priority ?? "—"}</td>
        <td className="px-3 py-2 capitalize">{c.severity ?? "—"}</td>
        <td className="px-3 py-2"><StatusPill raw={c.devStatus} /></td>
        <td className="px-3 py-2"><StatusPill raw={c.testerStatus} /></td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800/60 dark:bg-zinc-800/10">
          <td />
          <td colSpan={8} className="space-y-2 px-3 py-3">
            {error ? (
              <p className="text-xs text-destructive">Couldn&apos;t load this test case&apos;s details. Collapse and expand the row to retry.</p>
            ) : !detail ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <>
                {detail.module && <Detail label="Module" text={detail.module} />}
                <Detail label="Preconditions" text={detail.preconditions} />
                <Detail label="Steps" text={detail.steps} />
                <Detail label="Expected result" text={detail.expected} />
              </>
            )}
            <div onClick={(e) => e.stopPropagation()}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Feedback</p>
              <CommentThread
                roundId={review.roundId}
                caseId={c.id}
                comments={review.comments}
                viewer={review.viewer}
                reviewers={review.reviewers}
                committerEmail={review.committerEmail}
                readOnly={!review.isLatest}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-xs text-foreground">{text || "—"}</p>
    </div>
  );
}
