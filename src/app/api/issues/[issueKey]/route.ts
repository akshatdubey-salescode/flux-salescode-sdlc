import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getIssueDetail } from "@/lib/jira/issue-detail";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ issueKey: string }> }
) {
  await requireAuth();
  const { issueKey } = await params;
  const data = await getIssueDetail(issueKey.toUpperCase());
  if (!data) return Response.json({ error: "Issue not found" }, { status: 404 });
  return Response.json(data);
}
