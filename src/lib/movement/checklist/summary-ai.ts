/**
 * The optional AI layer over the rollup: instructions, the request for MiniMax, and a STRICT merge of
 * whatever the model answers.
 *
 * Pure functions only (no network): the service layer calls `callLlm` with `buildSummaryRequest(...).request`
 * and hands the response to `applySummary`. The rollup stays the source of truth: the model may reword
 * titles and lines, add at-a-glance bullets and re-badge harmless entries, but it can never remove,
 * downgrade or re-number an entry that needs attention, never invent a Jira key, and an empty or
 * invalid answer falls back to the deterministic summary.
 */
import { createHash } from "node:crypto";
import type { LlmRequest, LlmResponse, LlmTool } from "@/lib/llm/minimax";
import { canonical } from "./canon";
import { cap, tidy, wellFormed } from "./normalize";
import { BADGES, SEVERITIES, type Badge, type Glance, type Rollup, type RollupEntry, type RollupSection } from "./rollup";
import { SECTIONS, type ItemSeverity, type SectionId } from "./types";

// ---------------------------------------------------------------------------------------------
// the instructions (editable by the user)
// ---------------------------------------------------------------------------------------------

/**
 * How the summary is to be written. This text is the system prompt: edit it to change the style of the
 * summary (changing it also changes `summaryHash`, so cached summaries are refreshed).
 */
export const SUMMARY_INSTRUCTIONS = `You write the SUMMARY of an environment movement for the DEVOPS / RELEASE team of a software company.
The summary is read at a glance, just before a release, by people who are not engineers (release managers, QA, business analysts). It must be easy to understand at the first read, and it must make the important points impossible to miss.

INPUT
You get one JSON object: the deterministic roll-up of the checklists of all Jiras of the movement (environment, the list of Jira keys, a headline, the deterministic "atAGlance" list, and the sections with their entries). Each entry has a key, title, badge, severity, one line, the Jiras behind it, and sometimes counts. The roll-up is already correct: it merges what every Jira says (services listed once with all Jiras, "App release REQUIRED" when any Jira requires it, one entry per config key, and so on). Your job is to make it fast to read, not to change the facts.

THE READER'S QUESTIONS (answer these, in this order of importance)
1. What do we deploy, and in what order?
2. What must be configured, run or built first (configs without a value for this environment, SQL, app build, bundle SDK build)?
3. What can break (restarts and downtime, held or blocked reviews, reverted or not-yet-merged PRs, missing approvals)?
4. What is missing or still to be tested?
5. Who must answer (owners of the open questions)?

STYLE RULES (write for a normal person who is not an engineer)
- Plain language. Short sentences, about 15 words each. Everyday words: say "run", "set", "restart", "wait for", not "execute", "provision", "propagate". Explain a technical word the first time you use it, or leave it out.
- Start every title and every line with ONE action verb, in capitals or plain (for example "SET the prod value of ...", "RESTART Channel Kart", "RUN each report once", "WAIT for the DB owner"). The reader should see what to DO before anything else.
- Say each fact ONCE. Do not repeat a title inside its own detail, do not list the same Jiras in the title, the detail and the line, and do not say the same thing in two bullets.
- Do not use these words: "row", "union", "overlay", "roll-up", "rollup", "record", "payload", "flag the entry". Say "item" or "question" or "check" instead. No abbreviations the reader may not know; if one is needed, write it out the first time.
- No tags such as [V], [I], (D2) and no "see row 6" or "see below": say the thing itself or leave it out.
- Crisp and scannable. No paragraphs, no filler, no greetings.
- "headline": ONE sentence, at most 160 characters, with the numbers that matter (Jiras, PRs, items needing attention, open questions).
- "glance": at most 8 bullets (never more than 10), most severe first (blockers, then warnings, then information). Each bullet: "title" at most 80 characters that STARTS WITH ONE ACTION VERB (for example "REQUIRE app build ...", "SET prod value for ...", "RESTART Channel Kart ..."); "detail" at most 140 characters, one short sentence that adds something the title does not say; "badge" and "severity" from the fixed sets below; "jiras": the Jira keys behind the bullet (only keys that appear in the input).
- Group duplicates. One bullet per theme, not one per Jira. Name Jira keys; when more than 8, name 8 and write "+N".
- Prefer concrete numbers ("3 configs have no PROD value", not "some configs").
- If an owner must answer, write "not known yet - <owner> to confirm", for example "not known yet - devops to confirm". NEVER guess a value.
- NEVER invent a service, a config key, a PR, a Jira key, a branch or a value. Use only what is in the input. If you are not sure, leave it out.
- Keep every entry that has severity "warn" or "blocker" or "needsAttention": you may reword its title or line, you may not hide it, lower it or change its Jiras or numbers.

FIXED SETS
badge: REQUIRED, NOT REQUIRED, DONE, NOT DONE, UNKNOWN, YES, NO, ATTENTION, INFO
severity: blocker, warn, info

OUTPUT
Call the tool "submit_summary" exactly once with: "headline", "glance" (the bullets), and optionally "entries": rewrites of entry wording, each with "sectionId" and "key" copied EXACTLY from the input, and optionally a shorter "title" (at most 80 characters) and a crisper "line" (at most 140 characters). Do not add entries that are not in the input. To rewrite one of the input's at-a-glance items, reuse its "id".`;

// ---------------------------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------------------------

export const SUMMARY_TOOL_NAME = "submit_summary";
export const MAX_SUMMARY_USER_CHARS = 20_000;
const MAX_HEADLINE = 160;
const MAX_TITLE = 80;
const MAX_DETAIL = 200;
const MAX_LINE = 140;
const MAX_GLANCE_OUT = 10;

const SECTION_IDS = SECTIONS.map((s) => s.id);

export const SUMMARY_TOOL: LlmTool = {
  name: SUMMARY_TOOL_NAME,
  description: "Submit the devops summary of the movement: a one-sentence headline, the at-a-glance bullets, and optional rewrites of entry wording.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", maxLength: MAX_HEADLINE },
      glance: {
        type: "array",
        maxItems: MAX_GLANCE_OUT,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Reuse the id of an input at-a-glance item when you rewrite it" },
            badge: { type: "string", enum: [...BADGES] },
            severity: { type: "string", enum: [...SEVERITIES] },
            title: { type: "string", maxLength: MAX_TITLE },
            detail: { type: "string", maxLength: MAX_DETAIL },
            jiras: { type: "array", items: { type: "string" } },
          },
          required: ["badge", "severity", "title"],
        },
      },
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sectionId: { type: "string", enum: SECTION_IDS },
            key: { type: "string", description: "Copied exactly from the input" },
            title: { type: "string", maxLength: MAX_TITLE },
            line: { type: "string", maxLength: MAX_LINE },
            badge: { type: "string", enum: [...BADGES] },
            severity: { type: "string", enum: [...SEVERITIES] },
          },
          required: ["sectionId", "key"],
        },
      },
    },
    required: ["headline", "glance"],
  },
};

export interface SummaryRequest {
  system: string;
  user: string;
  tool: LlmTool;
  /** Ready for `callLlm`. */
  request: LlmRequest;
  /** Entries left out of the prompt to stay within the size limit. */
  omittedEntries: number;
}

const PER_SECTION_STEPS = [60, 40, 30, 20, 15, 10, 6, 4, 3, 2];

function compactRollup(r: Rollup, perSection: number, lineMax: number): { json: string; omitted: number } {
  let omitted = 0;
  const sections = r.sections
    .filter((s) => s.entries.length)
    .map((s) => {
      const shown = s.entries.slice(0, perSection);
      omitted += s.entries.length - shown.length;
      return {
        id: s.id,
        omitted: s.entries.length - shown.length || undefined,
        entries: shown.map((e) => ({
          key: e.key,
          title: e.title,
          badge: e.badge,
          severity: e.severity,
          line: cap(e.line, lineMax),
          jiras: e.jiras.slice(0, 8),
          moreJiras: e.jiras.length > 8 || e.moreJiras ? e.jiras.length - 8 + (e.moreJiras ?? 0) : undefined,
          counts: e.counts,
          attention: e.needsAttention || undefined,
        })),
      };
    });
  const obj = {
    environment: r.environment,
    jiras: r.jiraKeys,
    headline: r.headline,
    atAGlance: r.atAGlance.map((g) => ({ id: g.id, badge: g.badge, severity: g.severity, title: g.title, detail: g.detail, jiras: g.jiras.slice(0, 8) })),
    sections,
  };
  return { json: JSON.stringify(obj), omitted };
}

/** The system prompt, the (size-bounded) user message and the structured-output tool for MiniMax. */
export function buildSummaryRequest(rollup: Rollup): SummaryRequest {
  let out = compactRollup(rollup, PER_SECTION_STEPS[0], 110);
  for (const n of PER_SECTION_STEPS.slice(1)) {
    if (out.json.length <= MAX_SUMMARY_USER_CHARS) break;
    out = compactRollup(rollup, n, n <= 6 ? 70 : 110);
  }
  const user = `Movement roll-up (JSON). Write the summary by calling ${SUMMARY_TOOL_NAME}.\n${out.json}`;
  return {
    system: SUMMARY_INSTRUCTIONS,
    user,
    tool: SUMMARY_TOOL,
    request: { system: SUMMARY_INSTRUCTIONS, messages: [{ role: "user", content: user }], maxTokens: 12000, tools: [SUMMARY_TOOL], forceTool: SUMMARY_TOOL_NAME },
    omittedEntries: out.omitted,
  };
}

// ---------------------------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------------------------

export interface MergedSummary {
  source: "ai" | "rules";
  headline: string;
  glance: Glance[];
  sections: RollupSection[];
  /** What the validation dropped or corrected (for logs and a "why is this not what the model said" hint). */
  notes: string[];
}

/** The deterministic one-line headline. */
export function rulesHeadline(r: Rollup): string {
  const h = r.headline;
  const parts = [`${h.jiras} Jira${h.jiras === 1 ? "" : "s"}, ${h.prs} PR${h.prs === 1 ? "" : "s"} for ${r.environment.toUpperCase()}`, `${h.needAttention} need attention`];
  if (h.notDone) parts.push(`${h.notDone} rows not done`);
  if (h.unknowns) parts.push(`${h.unknowns} open questions`);
  if (h.conflicts) parts.push(`${h.conflicts} conflicts`);
  return cap(parts.join(" — "), MAX_HEADLINE);
}

/** Pull the structured answer out of a `callLlm` response: the tool call, else JSON in a text block. */
export function summaryFromResponse(resp: LlmResponse | null | undefined): unknown {
  if (!resp) return null;
  const tool = resp.blocks.find((b) => b.type === "tool_use" && b.name === SUMMARY_TOOL_NAME);
  if (tool && tool.type === "tool_use") return tool.input;
  const text = resp.blocks.find((b) => b.type === "text");
  return text && text.type === "text" ? text.text : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const SEV_RANK: Record<ItemSeverity, number> = { info: 0, warn: 1, blocker: 2 };
const BADGE_SET = new Set<string>(BADGES);
const SEV_SET = new Set<string>(SEVERITIES);
const SECTION_SET = new Set<string>(SECTION_IDS);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? cap(tidy(wellFormed(v), max * 3), max) : "";
}

/** Text a model wrote: whitespace collapsed, no control characters, no markup that could break a page. */
function plain(v: unknown, max: number): string {
  return str(v, max).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
}

function parseOutput(output: unknown): Record<string, unknown> | null {
  let v = output;
  if (typeof v === "string") {
    const t = v.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    if (!t || t.length > 200_000) return null;
    try {
      v = JSON.parse(t);
    } catch {
      return null;
    }
  }
  return isObj(v) ? v : null;
}

/** The deterministic result, as is. */
export function rulesSummary(rollup: Rollup, notes: string[] = []): MergedSummary {
  return { source: "rules", headline: rulesHeadline(rollup), glance: rollup.atAGlance.map((g) => ({ ...g })), sections: structuredClone(rollup.sections), notes };
}

/**
 * Merge the model's answer into the rollup, validating everything. See the file comment for the rules.
 * `output` is the tool input (an object), or a JSON string; anything else gives the deterministic summary.
 */
export function applySummary(rollup: Rollup, output: unknown): MergedSummary {
  const o = parseOutput(output);
  if (!o) return rulesSummary(rollup, ["the model's answer was not a JSON object: using the rule-based summary"]);
  const notes: string[] = [];
  const jiraSet = new Set(rollup.jiraKeys);

  const cleanJiras = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const out = new Set<string>();
    for (const x of v) {
      if (typeof x !== "string") continue;
      const k = x.trim();
      if (jiraSet.has(k)) out.add(k);
      else notes.push(`dropped unknown Jira key ${cap(wellFormed(k), 30)}`);
    }
    return [...out];
  };

  // ---- entries: reword only ------------------------------------------------------------------
  const sections = structuredClone(rollup.sections);
  const bySection = new Map<string, Map<string, RollupEntry>>(sections.map((s) => [s.id, new Map(s.entries.map((e) => [e.key, e]))]));
  let accepted = 0;
  const rawEntries = Array.isArray(o.entries) ? o.entries.slice(0, 600) : [];
  for (const re of rawEntries) {
    if (!isObj(re) || typeof re.sectionId !== "string" || !SECTION_SET.has(re.sectionId) || typeof re.key !== "string") {
      notes.push("dropped an entry rewrite with an unknown section");
      continue;
    }
    const e = bySection.get(re.sectionId)?.get(re.key);
    if (!e) {
      notes.push(`dropped an entry rewrite for an unknown entry ${cap(wellFormed(re.key), 40)}`);
      continue;
    }
    const protectedEntry = !!e.needsAttention || e.severity !== "info" || e.badge === "ATTENTION";
    const title = plain(re.title, MAX_TITLE);
    const line = plain(re.line, MAX_LINE);
    if (title) e.title = title;
    if (line) e.line = line;
    if (!protectedEntry) {
      // harmless entries: the model may re-badge them, and may raise (never lower) the severity
      if (typeof re.badge === "string" && BADGE_SET.has(re.badge)) e.badge = re.badge as Badge;
      if (typeof re.severity === "string" && SEV_SET.has(re.severity) && SEV_RANK[re.severity as ItemSeverity] > SEV_RANK[e.severity]) e.severity = re.severity as ItemSeverity;
    } else if ((typeof re.badge === "string" && re.badge !== e.badge) || (typeof re.severity === "string" && re.severity !== e.severity)) {
      notes.push(`kept the badge and severity of ${re.sectionId}/${e.key}`);
    }
    if (title || line) accepted++;
  }

  // ---- glance --------------------------------------------------------------------------------
  const det = new Map(rollup.atAGlance.map((g, i) => [g.id, { g, i }]));
  const isProtected = (g: Glance) => g.severity === "blocker" || g.badge === "ATTENTION";
  const model: Array<{ g: Glance; order: number; fromDet: boolean }> = [];
  const rawGlance = Array.isArray(o.glance) ? o.glance.slice(0, 30) : [];
  rawGlance.forEach((rg, idx) => {
    if (!isObj(rg)) return;
    const title = plain(rg.title, MAX_TITLE);
    const badge = typeof rg.badge === "string" && BADGE_SET.has(rg.badge) ? (rg.badge as Badge) : null;
    const severity = typeof rg.severity === "string" && SEV_SET.has(rg.severity) ? (rg.severity as ItemSeverity) : null;
    if (!title || !badge || !severity) {
      notes.push("dropped a glance bullet with a missing title or a badge / severity outside the fixed sets");
      return;
    }
    const id = typeof rg.id === "string" ? rg.id : "";
    const d = id ? det.get(id) : undefined;
    const detail = plain(rg.detail, MAX_DETAIL);
    if (d) {
      // a rewrite of a deterministic bullet: wording from the model, facts from the roll-up
      model.push({ g: { ...d.g, title, detail: detail || d.g.detail }, order: d.i, fromDet: true });
    } else {
      // an added bullet: the model may add warnings and information, never a blocker
      const jiras = cleanJiras(rg.jiras);
      model.push({ g: { id: `ai-${idx}`, badge, severity: severity === "blocker" ? "warn" : severity, title, detail, jiras }, order: 100 + idx, fromDet: false });
    }
  });
  const validGlance = model.length;
  const kept = new Set(model.filter((m) => m.fromDet).map((m) => m.g.id));
  for (const [id, { g, i }] of det) {
    if (isProtected(g) && !kept.has(id)) {
      model.push({ g: { ...g }, order: i, fromDet: true });
      if (rawGlance.length) notes.push(`kept the deterministic glance item ${id}`);
    }
  }
  const glance = model
    .sort((a, b) => SEV_RANK[b.g.severity] - SEV_RANK[a.g.severity] || Number(isProtected(b.g)) - Number(isProtected(a.g)) || a.order - b.order)
    .slice(0, MAX_GLANCE_OUT)
    .map((m) => m.g);

  const headline = plain(o.headline, MAX_HEADLINE);
  // nothing usable at all: the deterministic summary
  if (!headline && !accepted && validGlance === 0) return rulesSummary(rollup, [...notes, "the model's answer had nothing valid: using the rule-based summary"]);
  return {
    source: "ai",
    headline: headline || rulesHeadline(rollup),
    glance: validGlance > 0 && glance.length ? glance : rollup.atAGlance.map((g) => ({ ...g })),
    sections,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// cache key
// ---------------------------------------------------------------------------------------------

const INSTRUCTIONS_HASH = createHash("sha256").update(SUMMARY_INSTRUCTIONS).digest("hex").slice(0, 16);

/**
 * Stable hash of the rollup CONTENT plus the instructions: the service caches the AI summary by it, so a
 * changed answer, a changed Jira set or an edited instruction text asks the model again, anything else does not.
 */
export function summaryHash(rollup: Rollup): string {
  return createHash("sha256").update(canonical({ r: rollup, i: INSTRUCTIONS_HASH })).digest("hex");
}

/** Section ids, for callers that validate section references themselves. */
export const SUMMARY_SECTION_IDS: readonly SectionId[] = SECTION_IDS;
