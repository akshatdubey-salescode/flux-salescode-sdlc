// Turns the model's answer into validated findings. The model's output is untrusted: anything off is dropped or
// tamed here, so what reaches the database is always well-formed and bounded.

import type { LlmBlock } from "@/lib/llm/minimax";
import { FINDING_CATEGORIES, REPORT_TOOL, type FindingCategory } from "./baseline";

export type Severity = "high" | "medium" | "low";
export type Finding = { caseRef: string | null; severity: Severity; category: FindingCategory; message: string };
export type ReviewOutput = { summary: string; coverageNotes: string; findings: Finding[] };

export const MAX_FINDINGS = 100;
export const MAX_MESSAGE = 2500;
const MAX_SUMMARY = 800;
const SEVERITIES = new Set<string>(["high", "medium", "low"]);
const CATEGORIES = new Set<string>(FINDING_CATEGORIES);

/** The tool input from the model's blocks, else a JSON object found in its text; null when neither exists. */
export function extractReport(blocks: LlmBlock[]): unknown {
  for (const b of blocks) if (b.type === "tool_use" && b.name === REPORT_TOOL.name) return b.input;
  for (const b of blocks) {
    if (b.type !== "text") continue;
    const text = b.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* try the next block */
    }
  }
  return null;
}

/** The model sometimes quotes a case key the way the prompt shows it, "[Main::T1]": take the brackets and quotes off. */
export function normaliseRef(ref: string): string {
  return ref.trim().replace(/^[\s[("'`]+|[\s\])"'`]+$/g, "");
}

const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");

/**
 * Validates a report. A caseRef that isn't one of this round's cases is kept as a round-level finding with the
 * reference in the text, so a typo by the model never loses a finding or attaches it to the wrong case.
 */
export function parseReport(raw: unknown, knownRefs: ReadonlySet<string>): ReviewOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { summary?: unknown; coverageNotes?: unknown; findings?: unknown };
  if (!Array.isArray(r.findings)) return null;

  // Case keys are matched exactly first, then ignoring case (keys are unique within a round for practical purposes).
  const lower = new Map<string, string>();
  for (const k of knownRefs) if (!lower.has(k.toLowerCase())) lower.set(k.toLowerCase(), k);

  const findings: Finding[] = [];
  for (const item of r.findings) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    let message = clean(f.message, MAX_MESSAGE);
    if (message.length < 3) continue;
    const ref = clean(f.caseRef, 300) || null;
    let caseRef: string | null = null;
    if (ref) {
      const plain = normaliseRef(ref);
      const hit = knownRefs.has(plain) ? plain : (lower.get(plain.toLowerCase()) ?? null);
      if (hit) caseRef = hit;
      else message = `[${plain || ref}] ${message}`.slice(0, MAX_MESSAGE);
    }
    const severity = typeof f.severity === "string" && SEVERITIES.has(f.severity.toLowerCase()) ? (f.severity.toLowerCase() as Severity) : "medium";
    const category = typeof f.category === "string" && CATEGORIES.has(f.category) ? (f.category as FindingCategory) : "other";
    findings.push({ caseRef, severity, category, message });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { summary: clean(r.summary, MAX_SUMMARY), coverageNotes: clean(r.coverageNotes, MAX_SUMMARY), findings };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);

const STOP = new Set("the a an of to and or in on for with is are be as at by this that it its not no case cases add each every all any only also than then into from per via".split(" "));
const wordsOf = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
/** Share of the shorter message's words that the other also has: 1 = one contains the other. */
export function overlap(a: string, b: string): number {
  const A = wordsOf(a);
  const B = wordsOf(b);
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(1, Math.min(A.size, B.size));
}
/** Two parts of a split item often raise the same gap in different words; same case + same category + this much shared wording = one finding. */
export const SAME_FINDING_OVERLAP = 0.4;

/** Merges several chunks' outputs: findings de-duplicated (same case and same opening words), summaries joined. */
export function mergeReports(parts: ReviewOutput[]): ReviewOutput {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const p of parts) {
    for (const f of p.findings) {
      const key = `${f.caseRef ?? ""}|${f.category}|${norm(f.message)}`;
      if (seen.has(key)) continue;
      if (findings.some((g) => g.caseRef === f.caseRef && g.category === f.category && overlap(g.message, f.message) >= SAME_FINDING_OVERLAP)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const join = (xs: string[]) => [...new Set(xs.filter(Boolean))].join(" ").slice(0, MAX_SUMMARY);
  return {
    summary: join(parts.map((p) => p.summary)),
    coverageNotes: join(parts.map((p) => p.coverageNotes)),
    findings: findings.slice(0, MAX_FINDINGS),
  };
}
