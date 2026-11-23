/** Canonical JSON and per-item content, shared by the hash, the diff and the build (item hashes). */
import { createHash } from "node:crypto";
import type { ChecklistItem, ItemSource } from "./types";

/** JSON with sorted object keys and no `undefined`: the canonical form that gets hashed. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export const srcTuple = (s: ItemSource): [string, string, number] => [s.jira, s.pr, s.section ?? 0];

export function sortedSources(list: ItemSource[]): Array<[string, string, number]> {
  return list.map(srcTuple).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));
}

/** Everything that makes an item what it is (not its id / ih, which derive from it). */
export function itemContent(it: ChecklistItem): unknown {
  return {
    key: it.key,
    text: it.text,
    sev: it.severity,
    label: it.label,
    raw: it.raw,
    attn: it.needsAttention,
    env: it.env,
    config: it.config,
    seq: it.seq,
    group: it.group,
    jiras: it.jiras,
    chips: it.chips,
    count: it.count,
    answers: it.answers,
    more: it.moreSources,
    src: sortedSources(it.sources),
    conflict: it.conflict && {
      kind: it.conflict.kind,
      variants: it.conflict.variants.map((v) => ({ text: v.text, src: sortedSources(v.sources) })),
    },
  };
}

/** Short content hash of an item: an "acknowledged" mark is valid only while this is unchanged. */
export function itemHash(it: ChecklistItem): string {
  return createHash("sha1").update(canonical(itemContent(it))).digest("hex").slice(0, 12);
}
