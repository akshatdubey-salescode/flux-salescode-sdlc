// The compact preview the submission page shows after Validate: counts, splits,
// sections, issues and the first rows. Built from the parsed sheet only.

import type { ParsedSheet, ParseIssue, SectionInfo, UnmappedValue } from "./template";
import type { TcCategory, TcPolarity } from "./values";

export const PREVIEW_ROWS = 25;
export const PREVIEW_ISSUES = 100;

export type PreviewRow = {
  tcId: string;
  section: string | null;
  title: string;
  category: TcCategory;
  polarity: TcPolarity | null;
  priority: string | null;
  severity: string | null;
  devStatus: string;
  testerStatus: string;
};

export type Preview =
  | {
      ok: true;
      layout: "A" | "B";
      caseCount: number;
      sections: SectionInfo[];
      categorySplit: Partial<Record<TcCategory, number>>;
      polaritySplit: Partial<Record<TcPolarity, number>>;
      errorCount: number;
      warningCount: number;
      /** Errors first, then warnings, capped. */
      issues: ParseIssue[];
      unmapped: UnmappedValue[];
      rows: PreviewRow[];
      /** Commit is allowed only when there are no errors. */
      canCommit: boolean;
    }
  | { ok: false; error: string };

function nonZero<K extends string>(split: Record<K, number>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const [k, n] of Object.entries(split) as [K, number][]) if (n > 0) out[k] = n;
  return out;
}

export function buildPreview(parsed: ParsedSheet): Preview {
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const errors = parsed.issues.filter((i) => i.severity === "error");
  const warnings = parsed.issues.filter((i) => i.severity === "warning");

  return {
    ok: true,
    layout: parsed.layout,
    caseCount: parsed.cases.length,
    sections: parsed.sections,
    categorySplit: nonZero(parsed.categorySplit),
    polaritySplit: nonZero(parsed.polaritySplit),
    errorCount: errors.length,
    warningCount: warnings.length,
    issues: [...errors, ...warnings].slice(0, PREVIEW_ISSUES),
    unmapped: parsed.unmapped,
    rows: parsed.cases.slice(0, PREVIEW_ROWS).map((c) => ({
      tcId: c.tcId,
      section: c.section,
      title: c.title,
      category: c.category,
      polarity: c.polarity,
      priority: c.priority,
      severity: c.severity,
      devStatus: c.devStatus,
      testerStatus: c.testerStatus,
    })),
    canCommit: errors.length === 0,
  };
}
