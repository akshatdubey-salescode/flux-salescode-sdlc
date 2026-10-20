// Normalises the free-text values people type into the TC template (types,
// priorities, severities, statuses) into the controlled vocabularies. Every
// function reports whether the input was recognised, so unrecognised values
// can be shown to the user instead of silently dropped.

import type { TcCategory, TcPolarity, TcPriority, TcResult, TcSeverity } from "./values";

export type Norm<T> = { value: T; matched: boolean };

/** Lower-case, unify dashes, collapse whitespace. */
export function cleanValue(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const POLARITY_MAP: Record<string, TcPolarity> = {
  positive: "positive",
  negative: "negative",
  "edge case": "edge",
  edge: "edge",
  "edge-case": "edge",
};

const CATEGORY_MAP: Record<string, TcCategory> = {
  functional: "functional",
  integration: "integration",
  regression: "regression",
  ui: "ui",
  "ui validation": "ui",
  "ui/ux": "ui",
  ux: "ui",
  api: "api",
  security: "security",
  boundary: "boundary",
  validation: "validation",
  "data validation": "data_validation",
  "non-functional": "non_functional",
  "non functional": "non_functional",
  performance: "non_functional",
};

export type TypeColumns = {
  polarity: TcPolarity | null;
  category: TcCategory;
  /** Non-empty values that fit neither list (reported to the user, never dropped). */
  unmatched: { column: "classification" | "type"; value: string }[];
};

/**
 * "TC CLASSIFICATION" and "TC TYPE" are used inconsistently across tabs: some
 * put Positive/Negative in one and Functional/Integration in the other, others
 * the reverse. So each value is recognised by what it says, not by its column.
 * The TC TYPE column wins when both hold a category.
 */
export function normalizeTypeColumns(classificationRaw: unknown, typeRaw: unknown): TypeColumns {
  const cells = [
    { column: "classification" as const, raw: classificationRaw },
    { column: "type" as const, raw: typeRaw },
  ];
  let polarity: TcPolarity | null = null;
  let category: TcCategory | null = null;
  let categoryFromType = false;
  const unmatched: TypeColumns["unmatched"] = [];

  for (const { column, raw } of cells) {
    const s = cleanValue(raw);
    if (!s) continue;
    const pol = POLARITY_MAP[s];
    const cat = CATEGORY_MAP[s];
    if (pol) {
      polarity ??= pol;
    } else if (cat) {
      if (category === null || (column === "type" && !categoryFromType)) {
        category = cat;
        categoryFromType = column === "type";
      }
    } else {
      unmatched.push({ column, value: String(raw ?? "").replace(/\s+/g, " ").trim() });
    }
  }
  return { polarity, category: category ?? (unmatched.length ? "other" : "unspecified"), unmatched };
}

export function normalizePriority(raw: unknown): Norm<TcPriority | null> {
  const s = cleanValue(raw);
  if (!s) return { value: null, matched: true };
  const p = /^p\s*([1-4])$/.exec(s);
  if (p) return { value: `P${p[1]}` as TcPriority, matched: true };
  if (["critical", "highest", "blocker", "urgent", "high"].includes(s)) return { value: "P1", matched: true };
  if (["medium", "major", "normal"].includes(s)) return { value: "P2", matched: true };
  if (["low", "minor", "lowest"].includes(s)) return { value: "P3", matched: true };
  return { value: null, matched: false };
}

const SEVERITY_MAP: Record<string, TcSeverity> = {
  critical: "critical",
  blocker: "critical",
  high: "high",
  major: "major",
  medium: "medium",
  moderate: "medium",
  low: "low",
  minor: "low",
  trivial: "low",
};

export function normalizeSeverity(raw: unknown): Norm<TcSeverity | null> {
  const s = cleanValue(raw);
  if (!s) return { value: null, matched: true };
  const hit = SEVERITY_MAP[s];
  return hit ? { value: hit, matched: true } : { value: null, matched: false };
}

const NOT_RUN_WORDS = new Set([
  "in progress",
  "done - not verified",
  "not run",
  "not started",
  "pending",
  "n/a",
  "na",
  "skipped",
  "not applicable",
  "invalid",
]);

/**
 * Dev / tester status to a result. "Done" counts as a pass (the sheets use it
 * that way), but "Done - Not Verified" does not. Anything starting with
 * "Blocked" (incl. "Blocked - Client Dependency") is blocked.
 */
export function normalizeResult(raw: unknown): Norm<TcResult> {
  const s = cleanValue(raw);
  if (!s) return { value: "not_run", matched: true };
  if (s === "passed" || s === "pass" || s === "done") return { value: "pass", matched: true };
  if (s === "failed" || s === "fail") return { value: "fail", matched: true };
  if (s.startsWith("blocked")) return { value: "blocked", matched: true };
  if (NOT_RUN_WORDS.has(s)) return { value: "not_run", matched: true };
  return { value: "not_run", matched: false };
}

export function parseYesNo(raw: unknown): boolean | null {
  const s = cleanValue(raw);
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
}
