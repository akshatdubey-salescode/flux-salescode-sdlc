// Pure email-subject templating for the client support report (user decision,
// 2026-11-25). Settings → Email subject holds a template such as
// "{client}: Ticket Summary {period} | {date}"; the subject is rendered once at
// build time and stored on the report, so the mail sent is the one previewed.
//
// Placeholders (case-insensitive, in {curly} or [square] brackets):
//   {client}  Settings → Client name (falls back to the Flux project name)
//   {project} the Flux project name
//   {period}  the report period label: MTD, YTD or the custom range
//   {date}    the report date, e.g. "27 Nov 2026"
// Anything else is left exactly as typed.

import { formatDayMonthYear } from "./ytd";

export const DEFAULT_SUBJECT_TEMPLATE = "Issue Report — Daily Update | {client} | {date}";
export const SUBJECT_PLACEHOLDERS = ["{client}", "{period}", "{date}", "{project}"] as const;
export const SUBJECT_MAX_LENGTH = 200;

export function renderSubject(
  template: string,
  vars: { client: string; project: string; period: string; reportDate: string },
): string {
  const t = template.trim() || DEFAULT_SUBJECT_TEMPLATE;
  const values: Record<string, string> = {
    client: vars.client,
    project: vars.project,
    period: vars.period,
    date: formatDayMonthYear(vars.reportDate),
  };
  return t
    .replace(/\{(\w+)\}|\[(\w+)\]/g, (m, a?: string, b?: string) => {
      const key = (a ?? b ?? "").toLowerCase();
      return key in values ? values[key] : m;
    })
    .replace(/\s+/g, " ")
    .trim();
}
