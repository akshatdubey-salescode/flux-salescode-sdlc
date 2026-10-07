"use client";

import { useState } from "react";
import { RiExternalLinkLine } from "@remixicon/react";
import {
  rag,
  RAG_BADGE,
  type Counts,
  type OwnerBreakdown,
  type ProjectRow,
  type ProjectStats,
  type SortKey,
} from "@/lib/bugs/aggregate";
import { BugModal } from "./bug-modal";
import { BugIssueList } from "./bug-issue-list";
import {
  ContribCell,
  CountCell,
  RcaMissingCell,
  SortableTh,
  type PriorityCol,
} from "./bug-board-shared";

const TOTAL_KEY = "__total__";

const TH = "px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500";

// ---------------------------------------------------------------------------
// Main table (By Project view) — mirrors the By Developer table, keyed by project
// ---------------------------------------------------------------------------

export function ProjectBoardTable({
  rows,
  team,
  grandTotal,
  rankByKey,
  sortBy,
  sortDir,
  onSort,
  visiblePriorityCols,
  showOpenColumn,
  onOpenBreakdown,
  onOpenTotal,
}: {
  rows: ProjectRow[];
  team: ProjectStats;
  grandTotal: Counts;
  /** Stable rank by Total across all filtered projects. */
  rankByKey: Map<string, number>;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  visiblePriorityCols: PriorityCol[];
  showOpenColumn: boolean;
  onOpenBreakdown: (row: ProjectRow, tab?: "developer" | "source") => void;
  onOpenTotal: () => void;
}) {
  // # + Project + visible-priority cols + Total + (Open) + RCA Unavail + % Share
  const colSpan = 2 + visiblePriorityCols.length + 3 + (showOpenColumn ? 1 : 0);

  return (
    <div className="max-h-screen overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0">
          <tr className="rounded-t-xl border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800">
            <th className="w-10 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">#</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <button
                type="button"
                onClick={() => onSort("name")}
                className="inline-flex items-center gap-1 uppercase hover:text-foreground"
              >
                Project
                <span className={sortBy === "name" ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}>
                  {sortBy === "name" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                </span>
              </button>
            </th>
            {visiblePriorityCols.map((c) => (
              <SortableTh key={c.key} label={c.label} sortKey={c.key} sortBy={sortBy} sortDir={sortDir} onSort={onSort} className={TH} />
            ))}
            <SortableTh label="Total" sortKey="total" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className={TH} />
            {showOpenColumn && (
              <SortableTh label="Open" sortKey="open" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className={TH} />
            )}
            <th className={TH} title="Bugs with no RCA entered in Jira (any status)">RCA Unavail</th>
            <SortableTh label="% Share" sortKey="total" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className={TH} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted-foreground">
                No bugs match the current filters.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const contrib = team.grandTotal > 0 ? (row.total / team.grandTotal) * 100 : 0;
              return (
                <tr
                  key={row.key}
                  onClick={() => onOpenBreakdown(row)}
                  className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/20"
                >
                  <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                    {sortBy === "total" ? rankByKey.get(row.key) ?? "—" : idx + 1}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenBreakdown(row); }}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {row.name}
                    </button>
                  </td>
                  {visiblePriorityCols.map((c) => (
                    <CountCell key={c.key} value={row[c.key]} avg={team.avg[c.key]} />
                  ))}
                  <CountCell value={row.total} avg={team.avg.total} bold />
                  {showOpenColumn && <CountCell value={row.open} avg={team.avg.open} />}
                  <RcaMissingCell value={row.rcaMissingTotal} />
                  <ContribCell pct={contrib} value={row.total} avg={team.avg.total} />
                </tr>
              );
            })
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="rounded-b-xl border-t-2 border-zinc-300 bg-zinc-50/90 dark:border-zinc-700 dark:bg-zinc-900/60">
              <td className="px-4 py-2.5" />
              <td className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground">
                <button type="button" onClick={onOpenTotal} className="hover:underline" title="Everyone's breakdown">
                  Total
                </button>
              </td>
              {visiblePriorityCols.map((c) => (
                <td key={c.key} className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                  {grandTotal[c.key] || <span className="font-normal text-muted-foreground/40">—</span>}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-xs font-extrabold tabular-nums text-foreground">{grandTotal.total}</td>
              {showOpenColumn && (
                <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">{grandTotal.open}</td>
              )}
              <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {grandTotal.rcaMissingTotal || <span className="font-normal text-muted-foreground/40">—</span>}
              </td>
              <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">100%</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Developer breakdown (inside a project's modal) — mirror of ProjectSplit
// ---------------------------------------------------------------------------

export function DeveloperSplit({
  row,
  visiblePriorityCols,
  dateFrom,
  dateTo,
  showOpenColumn,
  env,
  cfOnly,
  ownerKeys,
}: {
  row: ProjectRow;
  visiblePriorityCols: PriorityCol[];
  dateFrom?: string;
  dateTo?: string;
  showOpenColumn: boolean;
  env?: string;
  cfOnly: boolean;
  /** The board's Developers filter — scopes the project-wide "all issues" list so it matches the counts. */
  ownerKeys: string[];
}) {
  // The Total row spans several projects, and the issues API needs a project —
  // so its rows are read-only counts; open a single project to browse issues.
  const drill = row.projectId !== TOTAL_KEY;
  const devAvgTotal = row.owners.length > 0 ? row.total / row.owners.length : 0;
  const [allOpen, setAllOpen] = useState(false);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          {drill ? "Click a row or priority to browse those issues" : "Open a project to browse its issues"}
        </p>
        {drill && (
          <button
            type="button"
            onClick={() => setAllOpen(true)}
            className="rounded border border-input bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Browse all {row.total} issues
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100/60 text-left dark:bg-zinc-800/50">
              <th className="px-3 py-2 font-semibold uppercase tracking-wide text-zinc-500">Developer</th>
              {visiblePriorityCols.map((c) => (
                <th key={c.key} className="w-12 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500">{c.label}</th>
              ))}
              <th className="w-14 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500">Total</th>
              {showOpenColumn && (
                <th className="w-14 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500">Open</th>
              )}
              <th
                className="w-20 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500"
                title="Bugs with no RCA entered in Jira (any status)"
              >
                RCA Unavail
              </th>
              <th className="w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right font-semibold uppercase tracking-wide text-zinc-500">% Share</th>
            </tr>
          </thead>
          <tbody>
            {row.owners.map((o) => (
              <DeveloperRowView
                key={o.key}
                o={o}
                projectId={drill ? row.projectId : undefined}
                projectName={row.name}
                projectTotal={row.total}
                devAvgTotal={devAvgTotal}
                visiblePriorityCols={visiblePriorityCols}
                dateFrom={dateFrom}
                dateTo={dateTo}
                showOpenColumn={showOpenColumn}
                env={env}
                cfOnly={cfOnly}
              />
            ))}
          </tbody>
        </table>
      </div>

      {drill && (
        <BugModal open={allOpen} onOpenChange={setAllOpen} title={`${row.name} — all issues`}>
          <BugIssueList
            projectId={row.projectId}
            from={dateFrom}
            to={dateTo}
            ownerKeys={ownerKeys}
            env={env}
            cfOnly={cfOnly}
          />
        </BugModal>
      )}
    </div>
  );
}

function DeveloperRowView({
  o,
  projectId,
  projectName,
  projectTotal,
  devAvgTotal,
  visiblePriorityCols,
  dateFrom,
  dateTo,
  showOpenColumn,
  env,
  cfOnly,
}: {
  o: OwnerBreakdown;
  /** Undefined on the Total row — its rows aren't drillable (no single project to scope the issue list to). */
  projectId?: string;
  projectName: string;
  projectTotal: number;
  devAvgTotal: number;
  visiblePriorityCols: PriorityCol[];
  dateFrom?: string;
  dateTo?: string;
  showOpenColumn: boolean;
  env?: string;
  cfOnly: boolean;
}) {
  const contrib = projectTotal > 0 ? (o.total / projectTotal) * 100 : 0;
  const badge = o.isUnassigned ? "" : RAG_BADGE[rag(o.total, devAvgTotal)];
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openIssues = (priority?: string) => {
    if (!projectId) return;
    setPriorityFilter(priority ?? null);
    setModalOpen(true);
  };

  return (
    <>
      <tr
        className={`border-t border-zinc-100 transition-colors dark:border-zinc-800/60 ${
          projectId ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30" : ""
        }`}
        onClick={() => openIssues()}
      >
        <td className="min-w-0 px-3 py-2">
          <span className={`flex min-w-0 items-center gap-1.5 font-medium ${o.isUnassigned ? "italic text-muted-foreground" : "text-foreground"}`}>
            <span className="truncate" title={o.name}>{o.name}</span>
            {projectId && <RiExternalLinkLine size={10} className="shrink-0 opacity-40" />}
          </span>
        </td>
        {visiblePriorityCols.map((c) => (
          <td key={c.key} className="px-2 py-2 text-right tabular-nums">
            {o[c.key] ? (
              projectId ? (
                <button
                  onClick={(e) => { e.stopPropagation(); openIssues(c.jql); }}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {o[c.key]}
                </button>
              ) : (
                <span className="font-medium text-foreground">{o[c.key]}</span>
              )
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </td>
        ))}
        <td className="px-2 py-2 text-right tabular-nums font-bold text-foreground">{o.total}</td>
        {showOpenColumn && (
          <td className="px-2 py-2 text-right tabular-nums text-foreground">{o.open}</td>
        )}
        <td className="px-2 py-2 text-right tabular-nums">
          {o.rcaMissingTotal ? (
            <span className="font-medium text-amber-700 dark:text-amber-400">{o.rcaMissingTotal}</span>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </td>
        <td className="py-2 pl-2 pr-3 text-right tabular-nums">
          {badge
            ? <span className={badge}>{contrib.toFixed(1)}%</span>
            : <span className="text-foreground">{contrib.toFixed(1)}%</span>}
        </td>
      </tr>

      {projectId && (
        <BugModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          title={`${projectName} — ${o.name}${priorityFilter ? ` — ${priorityFilter}` : ""}`}
        >
          <BugIssueList
            projectId={projectId}
            priority={priorityFilter ?? undefined}
            from={dateFrom}
            to={dateTo}
            ownerKey={o.isUnassigned ? undefined : o.key}
            unassignedOnly={o.isUnassigned}
            env={env}
            cfOnly={cfOnly}
          />
        </BugModal>
      )}
    </>
  );
}
