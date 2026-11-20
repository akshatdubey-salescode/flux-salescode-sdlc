// Pure approval/permission/env-gate rules. No DB imports (type-only) so they
// are unit-testable without a connection; re-exported from send.ts.

import { hasMinRole } from "@/lib/auth/types";
import type { AuthUser } from "@/lib/auth/server";
import type { SettingsInput } from "./store";
import type { SupportReportData } from "./types";

export class ConflictError extends Error {
  constructor(message = "Report is not awaiting approval") {
    super(message);
    this.name = "ConflictError";
  }
}

export function isSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPPORT_REPORTS_SEND_ENABLED === "true";
}

export function canApproveReports(
  user: Pick<AuthUser, "id" | "email" | "role">,
  settings: Pick<SettingsInput, "approverUserIds">,
): boolean {
  if (hasMinRole(user.role, "ADMIN")) return true;
  const listed = new Set(settings.approverUserIds.map((s) => s.toLowerCase()));
  return (
    settings.approverUserIds.includes(user.id) ||
    listed.has(user.id.toLowerCase()) ||
    listed.has(user.email.toLowerCase())
  );
}

export function approvalBlocker(
  report: { status: string; data: SupportReportData },
  settings: SettingsInput,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isSendEnabled(env)) return "Sending is disabled in this environment";
  if (report.status === "lapsed") return "This report has lapsed";
  if (report.status === "sent" || report.status === "sending") return "Already sent";
  const n = report.data.uncategorised.length;
  if (n > 0) return `${n} ticket(s) are uncategorised — categorise them and rebuild`;
  if (settings.toEmails.length === 0) return "No To recipients configured";
  return null;
}
