import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { renderSupportReportEmail } from "@/lib/support/render-email";
import { approvalBlocker } from "@/lib/support/send";
import { getSettings } from "@/lib/support/store";
import { guardReport } from "@/lib/support/route-guard";

type Params = { params: Promise<{ id: string; reportId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id, reportId } = await params;
  const g = await guardReport(id, reportId);
  if ("res" in g) return g.res;
  const { report } = g;
  const settings = await getSettings(id);
  const { subject, html } = renderSupportReportEmail(report.data);
  return NextResponse.json({
    report: { ...report, builtAt: report.builtAt.toISOString() },
    html,
    subject,
    blocker: approvalBlocker(report, settings),
  });
}
