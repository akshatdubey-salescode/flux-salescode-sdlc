import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import {
  processFreshdeskWebhook,
  type FreshdeskWebhookPayload,
} from "@/lib/freshdesk/webhook";

// Generic per-project Freshdesk webhook. The project is identified by the path
// segment and authenticated by the per-project webhook secret (query param),
// mirroring the Jira webhook at /api/webhooks/jira/[projectId].
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/webhooks/freshdesk/[projectId]">
) {
  const { projectId } = await ctx.params;

  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret) {
    return NextResponse.json({ error: "Missing secret" }, { status: 401 });
  }

  const [project] = await db
    .select({
      id: jiraProjects.id,
      webhookSecret: jiraProjects.webhookSecret,
      freshdeskCompanyId: jiraProjects.freshdeskCompanyId,
    })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, projectId), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (secret !== decrypt(project.webhookSecret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  if (!project.freshdeskCompanyId) {
    return NextResponse.json(
      { error: "Freshdesk is not configured for this project" },
      { status: 404 }
    );
  }

  let body: FreshdeskWebhookPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await processFreshdeskWebhook(project.id, body);
  return NextResponse.json(result.body, { status: result.status });
}
