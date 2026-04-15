import { requireAuth } from "@/lib/auth/server";
import { currentUser } from "@clerk/nextjs/server";

export async function POST(request: Request) {
  const user = await requireAuth();

  let body: { repo_names: string[]; access_token?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repo_names, access_token } = body;
  if (!repo_names?.length) {
    return Response.json({ error: "repo_names is required" }, { status: 400 });
  }

  if (!access_token) {
    return Response.json({ error: "SALESCODE_AUTH_REQUIRED" }, { status: 401 });
  }

  const apiUrl = process.env.CHARJAN_API_URL;
  const tenantId = process.env.CHARJAN_TENANT_ID;
  if (!apiUrl || !tenantId) {
    return Response.json(
      { error: "CHARJAN_API_URL and CHARJAN_TENANT_ID must be set" },
      { status: 500 }
    );
  }

  // ── Step 1: provision a runtime API key from charjan ──────────────────────
  const clerkUser = await currentUser();
  const name =
    clerkUser?.firstName
      ? `${clerkUser.firstName}${clerkUser.lastName ? ` ${clerkUser.lastName}` : ""}`
      : user.email.split("@")[0];

  console.log("[ai-session] provisioning key for", user.email);
  const provisionRes = await fetch(`${apiUrl}/api/v1/auth/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token, email: user.email, name }),
  });

  if (!provisionRes.ok) {
    const raw = await provisionRes.text().catch(() => "");
    console.error("[ai-session] provision failed", provisionRes.status, raw);
    return Response.json(
      { error: `Charjan provision failed (${provisionRes.status}): ${raw}` },
      { status: 502 }
    );
  }

  const { api_key } = await provisionRes.json();

  // ── Step 2: create session from project repos ──────────────────────────────
  console.log("[ai-session] creating session for repos:", repo_names);
  const sessionRes = await fetch(
    `${apiUrl}/api/v1/tenants/${tenantId}/agents/sessions/from-project`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": api_key },
      body: JSON.stringify({ repo_names }),
    }
  );

  if (!sessionRes.ok) {
    const raw = await sessionRes.text().catch(() => "");
    console.error("[ai-session] from-project failed", sessionRes.status, raw);
    return Response.json(
      { error: `Failed to create AI session (${sessionRes.status}): ${raw}` },
      { status: 502 }
    );
  }

  const sessionData = await sessionRes.json();
  console.log("[ai-session] session created:", sessionData);
  return Response.json({
    conversation_url: sessionData.conversation_url,
    api_key,
    tenant_id: tenantId,
  });
}
