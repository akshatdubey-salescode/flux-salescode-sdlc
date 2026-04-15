import { NextRequest, NextResponse } from "next/server";

const DEV_AUTH_URL = "https://dev-auth.salescode.ai";
const TENANT = "salescode_internal";

export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const state = searchParams.get("state");
  const code = searchParams.get("code");
  const scope = searchParams.get("scope") ?? "";
  const authuser = searchParams.get("authuser") ?? "0";
  const hd = searchParams.get("hd") ?? "";
  const prompt = searchParams.get("prompt") ?? "none";

  if (!state || !code) {
    return NextResponse.json({ error: "Missing state or code" }, { status: 400 });
  }

  const queryParams = new URLSearchParams({ state, code, scope, authuser, hd, prompt });
  const tokenUrl = `${DEV_AUTH_URL}/v1/authenticate/sso/salescode_internal_google/token?${queryParams}`;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Tenant: TENANT,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[salescode-token] fetch failed:", err);
    return NextResponse.json({ error: "Token exchange failed" }, { status: 502 });
  }
}
