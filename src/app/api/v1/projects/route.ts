import { NextResponse, connection } from "next/server";
import { authenticateApiToken } from "@/lib/auth/api-token";
import { loadTokenProjects } from "@/lib/external-api/projects";

// Lists the projects this token can read, so callers can map a project's
// name or Jira key to the id the bug endpoints take. Docs: external-api/docs/bugs.ts.
export async function GET(request: Request) {
  await connection();
  try {
    const auth = await authenticateApiToken(request, "bugs:read");
    if (!auth.ok) return auth.response;
    const projects = await loadTokenProjects(auth.token);
    return NextResponse.json({ projects });
  } catch (error) {
    // Never log the request/headers here — they carry the bearer token.
    console.error("v1 projects error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong. Try again later." },
      { status: 500 }
    );
  }
}
