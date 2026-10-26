import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { isResponse, readJsonObject, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { addGuideline, listForProject, listLibrary, listReadableProjects } from "@/lib/test-cases/ai-review/knowledge";

const DENIED = "Only an admin can manage the AI review guidelines.";

/** The guidelines library; with ?projectId= also which pages that project has selected. Admins only. */
export async function GET(req: NextRequest) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: DENIED }, { status: 403 });
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (projectId !== null) {
    if (!isValidUuid(projectId)) return NextResponse.json({ error: "projectId must be a valid UUID" }, { status: 400 });
    return NextResponse.json(await listForProject(projectId));
  }
  const [pages, projects] = await Promise.all([listLibrary(), listReadableProjects()]);
  return NextResponse.json({ pages, projects });
}

/** Add a page to the library: fetched immediately, so a link that can't be read is refused with the reason. */
export async function POST(req: NextRequest) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: DENIED }, { status: 403 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const { url, readWithProjectId, isGeneral, includeChildren } = parsed.body;
  if (typeof url !== "string" || url.trim().length === 0 || url.length > 1000) return NextResponse.json({ error: "Paste the Confluence page link." }, { status: 400 });
  if (!isValidUuid(readWithProjectId)) return NextResponse.json({ error: "Choose which project's Jira account should read the page." }, { status: 400 });
  const result = await addGuideline({ url, readWithProjectId, isGeneral: isGeneral === true, includeChildren: includeChildren === true, addedBy: user.email });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ added: result.added, alreadyThere: result.alreadyThere, failed: result.failed }, { status: 201 });
}
