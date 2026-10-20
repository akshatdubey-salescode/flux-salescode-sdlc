// Stored files carry every detail in their name — project, feature, Jira ID,
// user and date/time — so a file is identifiable without opening it. Times are
// IST (the team's working timezone), computed without relying on the server's
// own timezone.

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

export function buildTcFileName(p: TcFileNameParts): string {
  const user = safeSegment(p.user.includes("@") ? p.user.split("@")[0] : p.user, 24);
  return [
    KIND_PREFIX[p.kind],
    `r${p.round}`,
    safeSegment(p.project, 30),
    safeSegment(p.jiraKey, 20),
    safeSegment(p.feature, 40),
    user,
    istStamp(p.at),
  ].join("_") + ".xlsx";
}

/** Object key: grouped by project and Jira ID, file name last. */
export function buildTcS3Key(p: TcFileNameParts & { projectKey: string }): string {
  return `tc/${safeSegment(p.projectKey, 20)}/${safeSegment(p.jiraKey, 20)}/${buildTcFileName(p)}`;
}
