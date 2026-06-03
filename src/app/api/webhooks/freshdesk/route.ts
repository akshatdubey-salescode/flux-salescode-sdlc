import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import {
  processFreshdeskWebhook,
  type FreshdeskWebhookPayload,
} from "@/lib/freshdesk/webhook";

// Legacy single-project Freshdesk webhook, scoped to CavinKare (CAV).
// CavinKare's Freshdesk automation rule was configured against this URL before
// the integration became multi-project, so it is kept working as-is. New
// projects use the per-project endpoint /api/webhooks/freshdesk/[projectId].
const CAV_PROJECT_KEY = "CAV";

export async function POST(req: Request) {
  console.log("[freshdesk-webhook] received request (legacy CAV endpoint)");

  let body: FreshdeskWebhookPayload;
  try {
    body = await req.json();
  } catch {
    console.error("[freshdesk-webhook] failed to parse JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("[freshdesk-webhook] payload:", JSON.stringify(body));

  // Look up the CAV project ID
  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.jiraProjectKey, CAV_PROJECT_KEY))
    .limit(1);

  if (!project) {
    console.error("[freshdesk-webhook] CAV project not found in DB");
    return NextResponse.json({ error: "CAV project not found" }, { status: 404 });
  }

  const result = await processFreshdeskWebhook(project.id, body);
  return NextResponse.json(result.body, { status: result.status });
}
