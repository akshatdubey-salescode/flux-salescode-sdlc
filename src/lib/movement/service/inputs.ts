/**
 * `delivery_movements.inputs`: ONE gzip'd JSON copy of the parsed records of ALL the movement's
 * items, so ticking Jiras, picking branches, overrides and sign-off rebuild the checklist with no
 * Jira call. It is rewritten only when the set of record pointers changes (`pointerHash`).
 *
 * Decoding is hostile-input safe (zlib aborts at the decompressed-size cap; shape is checked), and
 * a blob of an older INPUTS_VERSION reads as "absent" so a code upgrade just refreshes it.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { coversOf, isUnion } from "../covers";
import type { ParsedRecord } from "../record";
import { MAX_INPUTS_BYTES, MAX_WARNINGS_PER_ITEM, PARSER_VERSION } from "../values";

/**
 * Bump when ParsedRecord / the readiness output changes shape: the stored copy is then rebuilt on the next refresh.
 * 2: union records (`marker.scope`, `facts.covers`, release rows) are part of the stored records. A blob of version 1
 * reads as "missing", so the next refresh rebuilds it (nothing is lost: the records are re-read from Jira).
 */
export const INPUTS_VERSION = PARSER_VERSION;
export const MAX_DECODED_INPUTS_BYTES = 96 * 1024 * 1024;
export const MAX_INPUT_ITEMS = 200;

export class InputsError extends Error {}

export interface StoredWarning {
  code: string;
  message: string;
}

export interface StoredItem {
  /** jira_issues.id */
  issue: string;
  key: string;
  /** Newest record per PR over the item's whole Jira tree. */
  records: ParsedRecord[];
  /** The computed readiness at the time of writing (informational: the live value is the item row's). */
  readiness: "ready" | "blocked";
  warnings: StoredWarning[];
}

export interface StoredInputs {
  version: typeof INPUTS_VERSION;
  items: StoredItem[];
}

/** Hash of WHAT the blob contains: membership, and every record by (comment id, updated, PR). */
export function pointerHash(items: ReadonlyArray<Pick<StoredItem, "issue" | "records">>): string {
  const lines: string[] = [`v${INPUTS_VERSION}`];
  for (const it of [...items].sort((a, b) => (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0))) {
    lines.push(`I|${it.issue}`);
    // A per-PR record is identified by its PR; a union record by the PRs it covers (its comment id and
    // update time change the hash when the comment is edited or replaced).
    const recs = it.records.map((r) => {
      const who = isUnion(r) ? `U:${coversOf(r).map((c) => `${c.repo}#${c.pr}`).sort().join(",")}` : `${r.marker.repo ?? ""}#${r.marker.pr ?? ""}`;
      return `P|${who}|${r.comment.id}|${r.comment.updated ?? r.comment.created ?? ""}|${r.marker.version ?? ""}`;
    });
    recs.sort();
    for (const l of recs) lines.push(l);
  }
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function encodeInputs(items: StoredItem[], maxBytes: number = MAX_INPUTS_BYTES): Buffer {
  if (items.length > MAX_INPUT_ITEMS) throw new InputsError(`too many items (${items.length})`);
  const payload: StoredInputs = {
    version: INPUTS_VERSION,
    items: items.map((i) => ({ ...i, warnings: i.warnings.slice(0, MAX_WARNINGS_PER_ITEM) })),
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  if (gz.length > maxBytes) {
    throw new InputsError(`The parsed records are too large to store (${gz.length} bytes gzipped, limit ${maxBytes})`);
  }
  return gz;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Decode; any failure (size, gzip, JSON, version, shape) is null. */
export function decodeInputs(buf: Buffer | Uint8Array | null | undefined): StoredInputs | null {
  if (!buf || buf.length === 0 || buf.length > MAX_INPUTS_BYTES) return null;
  try {
    const v: unknown = JSON.parse(gunzipSync(buf, { maxOutputLength: MAX_DECODED_INPUTS_BYTES }).toString("utf8"));
    if (!isObj(v) || v.version !== INPUTS_VERSION || !Array.isArray(v.items) || v.items.length > MAX_INPUT_ITEMS) return null;
    for (const it of v.items) {
      if (!isObj(it) || typeof it.issue !== "string" || typeof it.key !== "string" || !Array.isArray(it.records)) return null;
      for (const r of it.records) if (!isObj(r) || !isObj(r.marker) || !isObj(r.comment)) return null;
      if (!Array.isArray(it.warnings)) it.warnings = [];
    }
    return v as unknown as StoredInputs;
  } catch {
    return null;
  }
}
