/**
 * Content hash and structured diff of a checklist.
 *
 * `hashChecklist` hashes CONTENT only: no timestamps, no comment ids, no stats. Items and
 * sources come out of `buildChecklist` in a canonical order, and sources are sorted again here,
 * so two builds of the same facts hash the same whatever order the records were posted in or
 * however often an identical text was re-posted.
 */
import { createHash } from "node:crypto";
import { canonical, itemContent, sortedSources } from "./canon";
import { cap, sliceSafe } from "./normalize";
import type { Checklist } from "./types";

export function hashChecklist(cl: Checklist): string {
  const content = {
    v: cl.version,
    env: cl.environment,
    branches: [...cl.scope.branches].sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0)),
    // Included set with readiness and override state (not the summary: a renamed ticket is no change).
    jiras: cl.scope.jiras.map((j) => ({ jira: j.jira, readiness: j.readiness, override: !!j.override, prs: j.prs })),
    held: cl.held.map((h) => h.jira).sort(),
    sections: cl.sections.map((s) => ({ id: s.id, items: s.items.map(itemContent) })),
    unknowns: cl.unknownsByOwner.map((g) => ({ owner: g.owner, more: g.more, items: g.items.map((i) => ({ text: i.text, src: sortedSources(i.sources) })) })),
    conflicts: cl.conflicts.map((c) => ({ kind: c.kind, section: c.section, key: c.itemKey, sub: c.sub, sev: c.severity, v: c.variants.map((v) => ({ text: v.text, src: sortedSources(v.sources) })) })),
    warnings: cl.warnings.map((w) => ({ code: w.code, message: w.message, count: w.count, src: sortedSources(w.sources) })),
  };
  return createHash("sha256").update(canonical(content)).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------------------------

export interface DiffEntry {
  section: string;
  key: string;
  text: string;
}

export interface ChangedEntry {
  section: string;
  key: string;
  from: string;
  to: string;
}

export interface ChecklistDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: ChangedEntry[];
  /** True counts, before the size cap. */
  counts: { added: number; removed: number; changed: number };
  /** Entries left out to stay under the byte cap. */
  truncated: number;
  /** The content hashes differ but no item, conflict or warning does (scope metadata only). */
  onlyMeta: boolean;
}

export interface DiffOptions {
  /** Cap on the serialised size in BYTES (UTF-8). Default 4096 (the events table); Infinity = the full diff for the UI. */
  maxBytes?: number;
}

export const MAX_DIFF_BYTES = 4096;

interface Flat {
  section: string;
  key: string;
  text: string;
  body: string;
}

/** Both texts, cut to a window that starts shortly before the first difference (a long text that changed at its end still shows the change). */
function windowAround(a: string, b: string, chars: number): [string, string] {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  let start = Math.max(0, i - 30);
  const low = (t: string) => {
    const c = t.charCodeAt(start);
    return c >= 0xdc00 && c <= 0xdfff;
  };
  if (start > 0 && (low(a) || low(b))) start--;
  const cut = (t: string) => `${start > 0 ? "…" : ""}${cap(t.slice(start), chars)}`;
  return [cut(a), cut(b)];
}

function flatten(cl: Checklist): Map<string, Flat> {
  const m = new Map<string, Flat>();
  const put = (section: string, key: string, text: string, body: unknown) => {
    m.set(`${section}|${key}`, { section, key, text, body: canonical(body) });
  };
  put("scope", "environment", cl.environment, cl.environment);
  for (const j of cl.scope.jiras) put("scope", `jira:${j.jira}`, `${j.jira} ${j.readiness}${j.override ? " (override)" : ""}`, { r: j.readiness, o: !!j.override, prs: j.prs });
  for (const h of cl.held) put("scope", `held:${h.jira}`, `${h.jira} held (${h.readiness})`, h.readiness);
  for (const b of cl.scope.branches) put("scope", `branch:${b.repo}:${b.branch}`, `${b.repo}: ${b.branch}`, b.branch);
  for (const s of cl.sections) for (const it of s.items) put(s.id, it.key, it.text, itemContent(it));
  for (const g of cl.unknownsByOwner) for (const u of g.items) put("unknown", `${g.owner || "-"}|${sliceSafe(u.text, 80)}`, `${g.owner || "no owner"}: ${u.text}`, sortedSources(u.sources));
  for (const c of cl.conflicts) put("conflict", c.id, c.title, { sev: c.severity, v: c.variants.map((v) => ({ t: v.text, s: sortedSources(v.sources) })) });
  for (const w of cl.warnings) put("warning", `${w.code}|${sliceSafe(w.message, 80)}`, w.message, { c: w.count, s: sortedSources(w.sources) });
  return m;
}

const byteLen = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/**
 * What changed between two checklists, keyed by (section, item key); conflicts and warnings are
 * keyed under their own pseudo-sections. Serialised size is kept under `maxBytes` (UTF-8 bytes):
 * entries are short, and the rest is only counted.
 */
export function diffChecklists(a: Checklist, b: Checklist, opts: DiffOptions = {}): ChecklistDiff {
  const maxBytes = opts.maxBytes ?? MAX_DIFF_BYTES;
  const full = maxBytes === Infinity;
  const textChars = full ? 400 : 70;
  const keyChars = full ? 200 : 60;
  const fa = flatten(a);
  const fb = flatten(b);
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: ChangedEntry[] = [];
  for (const [k, v] of fb) {
    const old = fa.get(k);
    if (!old) added.push({ section: v.section, key: cap(v.key, keyChars), text: cap(v.text, textChars) });
    else if (old.body !== v.body) {
      const [from, to] = windowAround(old.text, v.text, textChars);
      changed.push({ section: v.section, key: cap(v.key, keyChars), from, to });
    }
  }
  for (const [k, v] of fa) if (!fb.has(k)) removed.push({ section: v.section, key: cap(v.key, keyChars), text: cap(v.text, textChars) });

  const counts = { added: added.length, removed: removed.length, changed: changed.length };
  const total = counts.added + counts.removed + counts.changed;
  const onlyMeta = total === 0 && hashChecklist(a) !== hashChecklist(b);
  if (full) return { added, removed, changed, counts, truncated: 0, onlyMeta };

  const out: ChecklistDiff = { added: [], removed: [], changed: [], counts, truncated: 0, onlyMeta };
  // The wrapper is measured with the worst-case `truncated`, so the final size cannot exceed the cap.
  let budget = maxBytes - byteLen({ ...out, truncated: total }) - 2;
  const lists: Array<[unknown[], unknown[]]> = [
    [added, out.added],
    [changed, out.changed],
    [removed, out.removed],
  ];
  const pos = [0, 0, 0];
  let kept = 0;
  let progress = true;
  // Round robin so a flood of one kind cannot hide the others.
  while (progress) {
    progress = false;
    for (let i = 0; i < lists.length; i++) {
      const [src, dst] = lists[i];
      if (pos[i] >= src.length) continue;
      const e = src[pos[i]];
      const size = byteLen(e) + 1;
      if (size > budget) {
        pos[i] = src.length; // stop this list
        continue;
      }
      budget -= size;
      dst.push(e);
      pos[i]++;
      kept++;
      progress = true;
    }
  }
  out.truncated = total - kept;
  return out;
}
