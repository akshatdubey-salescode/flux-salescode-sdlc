// Shared preamble for the per-report API routes: flag, uuid, project scoping.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth-options";
import type { AuthUser } from "@/lib/auth/server";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { isValidUuid } from "@/lib/validation";
import { getReport, type SettingsInput } from "./store";
import { getSettings } from "./store";
import { canApproveReports } from "./approval";
import type { SupportReport } from "@/lib/db/schema";

export const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function displayName(user: AuthUser): Promise<string> {
  const session = await getServerSession(authOptions);
  return session?.user?.name?.trim() || user.email;
}

/** Flag on + valid project id, else the response to return. */
export async function guardProject(id: string): Promise<NextResponse | null> {
  if (!(await isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS))) return notFound();
  if (!isValidUuid(id)) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  return null;
}

/** Flag, uuids, report exists and belongs to the project. */
export async function guardReport(
  id: string,
  reportId: string,
): Promise<{ res: NextResponse } | { report: SupportReport }> {
  if (!(await isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS))) return { res: notFound() };
  if (!isValidUuid(id) || !isValidUuid(reportId)) {
    return { res: NextResponse.json({ error: "id and reportId must be valid UUIDs" }, { status: 400 }) };
  }
  const report = await getReport(reportId);
  if (!report || report.projectId !== id) return { res: notFound() };
  return { report };
}

/** Approver-or-ADMIN gate; returns settings on success. */
export async function requireApprover(
  user: AuthUser,
  projectId: string,
): Promise<{ res: NextResponse } | { settings: SettingsInput }> {
  const settings = await getSettings(projectId);
  if (!canApproveReports(user, settings)) {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { settings };
}
