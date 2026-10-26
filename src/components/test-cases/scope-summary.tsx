import { RiExternalLinkLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { parseSheetUrl, sheetRowUrl } from "@/lib/test-cases/sheet-url";
import type { RoundScope } from "@/lib/test-cases/scope";

/**
 * What this round reviewed: each tab and the rows of it, how many of the tab's test cases that is, and a link into the live
 * sheet at the first row. Shown on the round card so reviewers (and anyone reading feedback) know exactly which part of a
 * shared sheet is meant. Rounds from before rows could be chosen show "all rows".
 */
export function ScopeSummary({ scope, tabs, sheetUrl, className }: { scope: RoundScope | null; tabs: string[]; sheetUrl: string | null; className?: string }) {
  const sheetId = sheetUrl ? parseSheetUrl(sheetUrl)?.spreadsheetId ?? null : null;
  if (!scope) {
    if (tabs.length === 0) return null;
    return (
      <p className={cn("text-[11px] text-muted-foreground", className)}>
        Reviewed: every row of {tabs.length === 1 ? "the tab" : "the tabs"} <span className="font-medium text-foreground">{tabs.join(", ")}</span>.
      </p>
    );
  }
  return (
    <div className={cn("space-y-1 text-[11px]", className)}>
      {scope.defaulted && (
        <p className="rounded bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          No tab was named when this was submitted, so all test-case tabs were reviewed.
          {scope.skipped.length > 0 ? ` Skipped (not test-case sheets): ${scope.skipped.map((s) => s.tab).join(", ")}.` : ""}
        </p>
      )}
      <ul className="space-y-0.5 text-muted-foreground">
        {scope.tabs.map((t) => (
          <li key={t.tab} className="flex flex-wrap items-center gap-x-1.5">
            <span className="font-medium text-foreground">{t.tab}</span>
            <span>·</span>
            <span>{t.rows ? `rows ${t.rows}` : "all rows"}</span>
            <span>·</span>
            <span>
              {t.rows ? `${t.inScope} of ${t.totalInTab} test cases` : `${t.inScope} test case${t.inScope === 1 ? "" : "s"}`}
              {t.firstId && t.lastId && t.inScope > 1 ? ` (${t.firstId} … ${t.lastId})` : ""}
            </span>
            {sheetId && t.firstRow && (
              <a href={sheetRowUrl(sheetId, t.gid, t.firstRow)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                open at row {t.firstRow}
                <RiExternalLinkLine className="size-3 opacity-60" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
