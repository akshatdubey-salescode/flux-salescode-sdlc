// Stored files carry every detail in their name — project, feature, Jira ID,
// user and date/time — so a file is identifiable without opening it. Times are
// IST (the team's working timezone), computed without relying on the server's
// own timezone.

import { randomBytes } from "node:crypto";
import type { TcFileKind } from "./values";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istParts(at: Date) {
  const d = new Date(at.getTime() + IST_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    p,
  };
}

/** "20261014-154203" in IST. */
export function istStamp(at: Date): string {
  const t = istParts(at);
  return `${t.y}${t.p(t.mo + 1)}${t.p(t.d)}-${t.p(t.h)}${t.p(t.mi)}${t.p(t.s)}`;
}

/** "Round 2, 14 Oct 2026 15:42 IST" */
export function roundLabel(round: number, at: Date): string {
  const t = istParts(at);
  return `Round ${round}, ${t.d} ${MONTHS[t.mo]} ${t.y} ${t.p(t.h)}:${t.p(t.mi)} IST`;
}

/** "14 Oct 2026 15:42 IST" */
export function istDateTime(at: Date): string {
  const t = istParts(at);
  return `${t.d} ${MONTHS[t.mo]} ${t.y} ${t.p(t.h)}:${t.p(t.mi)} IST`;
}

/** Safe single path/file segment: letters, digits, dot, dash, underscore. */
export function safeSegment(input: string, max = 40): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    // Jira summaries often contain "..." and the store refuses any key with "..".
    .replace(/\.{2,}/g, ".")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "");
  return (cleaned || "x").slice(0, max).replace(/[_.-]+$/g, "") || "x";
}

export type TcFileNameParts = {
  kind: TcFileKind;
  round: number;
  project: string;
  jiraKey: string;
  feature: string;
  /** Uploader email or name; only the local part of an email is used. */
  user: string;
  at: Date;
};

const KIND_PREFIX: Record<TcFileKind, string> = {
  testcases: "TCs",
  signoff_dev: "DevSignoff",
  signoff_tester: "TesterSignoff",
  llm_feedback: "LLMFeedback",
  reviewer_feedback: "ReviewerFeedback",
};

function nameSegments(p: TcFileNameParts): string[] {
  const user = safeSegment(p.user.includes("@") ? p.user.split("@")[0] : p.user, 24);
  return [safeSegment(p.project, 30), safeSegment(p.jiraKey, 20), safeSegment(p.feature, 40), user, istStamp(p.at)];
}

export function buildTcFileName(p: TcFileNameParts): string {
  const [project, jira, feature, user, stamp] = nameSegments(p);
  return [KIND_PREFIX[p.kind], `r${p.round}`, project, jira, feature, user, stamp].join("_") + ".xlsx";
}

/**
 * Object key: grouped by project and Jira ID, file name last. It carries no round
 * number (that is only known once the item is locked for the commit, and the
 * file is uploaded before) and ends in a random nonce, so two uploads in the
 * same second can never overwrite each other. The readable name, with the round,
 * lives in the database and in the download's file name.
 */
export function buildTcS3Key(p: TcFileNameParts & { projectKey: string; nonce?: string }): string {
  const [project, jira, feature, user, stamp] = nameSegments(p);
  const nonce = p.nonce ?? randomBytes(4).toString("hex");
  const file = [KIND_PREFIX[p.kind], project, jira, feature, user, stamp, nonce].join("_") + ".xlsx";
  return `tc/${safeSegment(p.projectKey, 20)}/${safeSegment(p.jiraKey, 20)}/${file}`;
}
