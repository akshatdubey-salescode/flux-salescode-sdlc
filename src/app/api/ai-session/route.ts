import { requireAuth } from "@/lib/auth/server";
import { currentUser } from "@clerk/nextjs/server";

export async function POST(request: Request) {
  const user = await requireAuth();

  let body: { repo_names: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repo_names } = body;
  if (!repo_names?.length) {
    return Response.json({ error: "repo_names is required" }, { status: 400 });
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

  const provisionRes = await fetch(`${apiUrl}/api/v1/auth/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: "clerk-session",
      email: user.email,
      name,
    }),
  });

  if (!provisionRes.ok) {
    const err = await provisionRes.json().catch(() => ({}));
    return Response.json(
      { error: `Charjan provision failed: ${err?.detail ?? provisionRes.statusText}` },
      { status: 502 }
    );
  }

  const { api_key } = await provisionRes.json();

  // ── Step 2: create session from project repos ──────────────────────────────
  const sessionRes = await fetch(
    `${apiUrl}/api/v1/tenants/${tenantId}/agents/sessions/from-project`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
      },
      body: JSON.stringify({ repo_names }),
    }
  );

  if (!sessionRes.ok) {
    const err = await sessionRes.json().catch(() => ({}));
    return Response.json(
      { error: `Failed to create AI session: ${err?.detail ?? sessionRes.statusText}` },
      { status: 502 }
    );
  }

  const { conversation_url } = await sessionRes.json();

  return Response.json({ conversation_url, api_key, tenant_id: tenantId });
}
