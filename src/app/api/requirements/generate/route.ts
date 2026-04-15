import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { searchCharjan } from "@/lib/charjan/client";

export async function POST(request: Request) {
  await requireAuth();

  let body: { projectId: string; roughIdea: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, roughIdea } = body;

  if (!projectId || !roughIdea?.trim()) {
    return Response.json(
      { error: "projectId and roughIdea are required" },
      { status: 400 }
    );
  }

  const [project] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, projectId), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const prompt = `You are a senior business analyst writing a software requirement for the "${project.name}" project.

Based on the existing codebase context, generate a detailed, developer-ready requirement for:
"${roughIdea.trim()}"

Structure your entire response EXACTLY as follows (use these exact headings):

**Title:** [concise, action-oriented title — max 80 characters]

**Description:**
[Detailed functional description written as a user story or narrative. 150–300 words. Reference actual patterns, APIs, or components found in the codebase where relevant.]

**Acceptance Criteria:**
- [ ] [Specific, testable criterion 1]
- [ ] [Specific, testable criterion 2]
- [ ] [Specific, testable criterion 3]
- [ ] [Add more as needed]

Ground every statement in the actual codebase — do not invent patterns that don't exist.`;

  let charjanResult;
  try {
    charjanResult = await searchCharjan(prompt, "FULL");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Charjan search failed: ${message}` },
      { status: 502 }
    );
  }

  const parsed = parseRequirementFromAnswer(charjanResult.answer);

  return Response.json({
    ...parsed,
    charjanContext: {
      answer: charjanResult.answer,
      citations: charjanResult.citations,
    },
  });
}

type ParsedRequirement = {
  title: string;
  description: string;
  acceptanceCriteria: string;
};

function parseRequirementFromAnswer(answer: string): ParsedRequirement {
  const titleMatch = answer.match(/\*\*Title:\*\*\s*(.+?)(?:\n|$)/);
  const descriptionMatch = answer.match(
    /\*\*Description:\*\*\s*([\s\S]+?)(?=\*\*Acceptance Criteria:\*\*|$)/
  );
  const acMatch = answer.match(/\*\*Acceptance Criteria:\*\*\s*([\s\S]+?)$/);

  return {
    title: titleMatch?.[1]?.trim() ?? "Untitled Requirement",
    description: descriptionMatch?.[1]?.trim() ?? answer,
    acceptanceCriteria: acMatch?.[1]?.trim() ?? "",
  };
}
