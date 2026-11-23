/**
 * Snapshot of a checklist: JSON -> gzip, stored once per (movement, hash) at sign-off, start
 * and done so "what changed since you signed" survives an edited Jira comment.
 *
 * decode is hostile-input safe: compressed size cap, a hard cap on the DECOMPRESSED size (zip
 * bomb guard: zlib aborts at the limit, nothing is buffered past it) and a shape check before
 * the value is handed to callers.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { isMovementEnvironment, isMovementReadiness, MAX_SNAPSHOT_BYTES } from "../values";
import { MAX_CONFLICTS, MAX_ITEMS_PER_SECTION, MAX_WARNINGS, SECTIONS, type Checklist } from "./types";

export const MAX_DECODED_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export class SnapshotError extends Error {}

export function encodeSnapshot(cl: Checklist): Buffer {
  const json = Buffer.from(JSON.stringify(cl), "utf8");
  if (json.length > MAX_DECODED_SNAPSHOT_BYTES) throw new SnapshotError(`snapshot too large (${json.length} bytes of JSON)`);
  const gz = gzipSync(json, { level: 9 });
  if (gz.length > MAX_SNAPSHOT_BYTES) throw new SnapshotError(`snapshot too large (${gz.length} bytes gzipped, limit ${MAX_SNAPSHOT_BYTES})`);
  return gz;
}

export function decodeSnapshot(buf: Buffer | Uint8Array): Checklist {
  if (buf.length > MAX_SNAPSHOT_BYTES) throw new SnapshotError("snapshot too large");
  let json: string;
  try {
    json = gunzipSync(buf, { maxOutputLength: MAX_DECODED_SNAPSHOT_BYTES }).toString("utf8");
  } catch (e) {
    const code = (e as { code?: string }).code;
    throw new SnapshotError(code === "ERR_BUFFER_TOO_LARGE" ? "snapshot expands past the size limit" : "snapshot is not valid gzip");
  }
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new SnapshotError("snapshot is not valid JSON");
  }
  return validate(v);
}

/** Like `decodeSnapshot`, but any failure (size, gzip, JSON, shape) is `null`. */
export function safeDecodeSnapshot(buf: Buffer | Uint8Array | null | undefined): Checklist | null {
  if (!buf) return null;
  try {
    return decodeSnapshot(buf);
  } catch {
    return null;
  }
}

// --- deep shape validation ------------------------------------------------------------------------
// Every field the UI or the diff reads is type-checked and every array is bounded, so a corrupt or
// hostile snapshot fails here with a SnapshotError instead of crashing a renderer later.

const MAX_STR = 5000;
const SEVERITIES = new Set(["info", "warn", "blocker"]);
const CONFLICT_KINDS = new Set(["prod_branch", "config_default", "config_env_value", "downtime", "deploy_branch", "bundle_sdk", "branch_mismatch", "order_cycle", "row_state"]);
const SECTION_IDS = new Set<string>(SECTIONS.map((x) => x.id));

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_STR): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const arr = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const optStr = (v: unknown) => v === undefined || isStr(v);
const optNum = (v: unknown) => v === undefined || isNum(v);

function validSource(v: unknown): boolean {
  return isObj(v) && isStr(v.jira, 100) && isStr(v.pr, 200) && optNum(v.section) && optNum(v.n) && (v.covers === undefined || (arr(v.covers, 20) && v.covers.every((x) => isStr(x, 200))));
}
const validSources = (v: unknown, max = 200) => arr(v, max) && v.every(validSource);
function validVariants(v: unknown): boolean {
  return arr(v, 10) && v.every((x) => isObj(x) && isStr(x.text) && validSources(x.sources));
}
function validSev(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && SEVERITIES.has(v));
}
function validEnvVal(v: unknown): boolean {
  return v === null || isStr(v);
}

function validItem(it: unknown): boolean {
  if (!isObj(it)) return false;
  if (!isStr(it.key, 400) || !isStr(it.text, 2600) || !validSources(it.sources)) return false;
  if (!optStr(it.id) || !optStr(it.ih) || !optStr(it.label) || !optStr(it.group) || !optNum(it.seq) || !optNum(it.count) || !optNum(it.moreSources)) return false;
  if (!validSev(it.severity)) return false;
  if (it.raw !== undefined && it.raw !== true) return false;
  if (it.needsAttention !== undefined && it.needsAttention !== true) return false;
  if (it.jiras !== undefined && !(arr(it.jiras, 200) && it.jiras.every((j) => isStr(j, 100)))) return false;
  if (it.chips !== undefined && !(arr(it.chips, 50) && it.chips.every((j) => isStr(j, 200)))) return false;
  if (it.conflict !== undefined) {
    const c = it.conflict;
    if (!isObj(c) || typeof c.kind !== "string" || !CONFLICT_KINDS.has(c.kind) || !validVariants(c.variants)) return false;
  }
  if (it.env !== undefined) {
    const e = it.env;
    if (!isObj(e) || !isMovementEnvironment(e.target) || !validEnvVal(e.targetValue) || !isObj(e.values)) return false;
    if (!validEnvVal(e.values.demo) || !validEnvVal(e.values.uat) || !validEnvVal(e.values.prod)) return false;
  }
  if (it.config !== undefined) {
    const c = it.config;
    if (!isObj(c) || !isStr(c.key) || !optStr(c.store) || !optStr(c.default)) return false;
    if (c.aliases !== undefined && !(arr(c.aliases, 20) && c.aliases.every((a) => isStr(a)))) return false;
  }
  return true;
}

function validSignoff(v: unknown): boolean {
  return v === "missing" || (isObj(v) && isStr(v.by) && isStr(v.at));
}

function validOverride(v: unknown): boolean {
  return v === undefined || (isObj(v) && isStr(v.reason) && isStr(v.by));
}

function validate(v: unknown): Checklist {
  const bad = (why: string): never => {
    throw new SnapshotError(`snapshot has the wrong shape: ${why}`);
  };
  if (!isObj(v)) return bad("not an object");
  if (v.version !== 1) bad("version");
  if (!isMovementEnvironment(v.environment)) bad("environment");
  if (!optStr(v.hash) || !optStr(v.summary)) bad("hash/summary");

  const scope = v.scope;
  if (!isObj(scope) || !arr(scope.jiras, 1000) || !arr(scope.branches, 200)) return bad("scope");
  for (const j of scope.jiras) {
    if (!isObj(j) || !isStr(j.jira, 100) || !isMovementReadiness(j.readiness) || !optStr(j.summary) || !validOverride(j.override) || !arr(j.prs, 2000) || !j.prs.every((p) => isStr(p, 200))) bad("scope.jiras");
  }
  for (const b of scope.branches) if (!isObj(b) || !isStr(b.repo) || !isStr(b.branch)) bad("scope.branches");

  if (!Array.isArray(v.sections) || v.sections.length !== SECTIONS.length) return bad("sections");
  (v.sections as unknown[]).forEach((s, i) => {
    if (!isObj(s) || s.id !== SECTIONS[i].id || !isNum(s.number) || !isStr(s.title) || !arr(s.items, MAX_ITEMS_PER_SECTION)) return bad(`section ${i + 1}`);
    for (const it of s.items) if (!validItem(it)) bad(`item in section ${i + 1}`);
  });

  if (!arr(v.unknownsByOwner, 200)) return bad("unknownsByOwner");
  for (const g of v.unknownsByOwner) {
    if (!isObj(g) || !isStr(g.owner, 200) || !arr(g.items, 500) || !optNum(g.more)) bad("unknownsByOwner");
    for (const u of (g as { items: unknown[] }).items) if (!isObj(u) || !isStr(u.text) || !validSources(u.sources) || !optNum(u.moreSources)) bad("unknownsByOwner item");
  }

  if (!arr(v.conflicts, MAX_CONFLICTS)) return bad("conflicts");
  for (const c of v.conflicts) {
    if (!isObj(c) || typeof c.kind !== "string" || !CONFLICT_KINDS.has(c.kind) || typeof c.section !== "string" || !SECTION_IDS.has(c.section)) bad("conflict");
    const o = c as Record<string, unknown>;
    if (!isStr(o.itemKey) || !isStr(o.title) || !optStr(o.id) || !optStr(o.sub) || typeof o.severity !== "string" || !SEVERITIES.has(o.severity) || !validVariants(o.variants)) bad("conflict fields");
  }

  if (!arr(v.warnings, MAX_WARNINGS + 5)) return bad("warnings");
  for (const w of v.warnings) if (!isObj(w) || !isStr(w.code, 200) || !isStr(w.message) || !validSources(w.sources) || !optNum(w.count)) bad("warning");

  if (!arr(v.signoffs, 1000)) return bad("signoffs");
  for (const s of v.signoffs) if (!isObj(s) || !isStr(s.jira, 100) || !validSignoff(s.dev) || !validSignoff(s.tester) || typeof s.anyMissing !== "boolean") bad("signoffs");

  if (!arr(v.held, 5000)) return bad("held");
  for (const h of v.held) if (!isObj(h) || !isStr(h.jira, 100) || !isMovementReadiness(h.readiness) || !optStr(h.summary) || !validOverride(h.override)) bad("held");

  const st = v.stats;
  if (!isObj(st)) return bad("stats");
  if (!optNum(st.comments)) bad("stats.comments");
  for (const k of ["jiras", "included", "held", "records", "prs", "items", "conflicts", "unknowns", "needsAttention"]) if (!isNum(st[k])) bad(`stats.${k}`);
  const by = st.bySeverity;
  if (by !== undefined) {
    if (!isObj(by)) bad("stats.bySeverity");
    for (const part of ["items", "conflicts"]) {
      const c = (by as Record<string, unknown>)[part];
      if (!isObj(c) || !isNum(c.info) || !isNum(c.warn) || !isNum(c.blocker)) bad(`stats.bySeverity.${part}`);
    }
  }
  return v as unknown as Checklist;
}
