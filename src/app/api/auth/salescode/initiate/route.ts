import { NextRequest, NextResponse } from "next/server";

const DEV_AUTH_URL = "https://dev-auth.salescode.ai";
const TENANT = "salescode_internal";
const APP_NAME = "salescode_internal_app";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const redirectBack = searchParams.get("redirectBack") ?? "/requirements/new";

  // Use a clean URL (no query params) so dev-auth can append ?code=&state= correctly.
  // We pass redirectBack as a separate cookie so the callback page knows where to go.
  const callbackUrl = `${origin}/auth/salescode-callback`;

  const initiateUrl =
    `${DEV_AUTH_URL}/v1/authenticate/sso/salescode_internal_google` +
    `?tenant=${TENANT}` +
    `&targetUrl=${encodeURIComponent(callbackUrl)}` +
    `&app=${APP_NAME}`;

  let googleAuthUrl: string;
  try {
    const res = await fetch(initiateUrl, {
      method: "POST",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[salescode-auth] initiate failed", res.status, text);
      return NextResponse.json({ error: "Failed to initiate Salescode login" }, { status: 502 });
    }

    const data = await res.json();
    googleAuthUrl = data?.content?.[0];
    if (!googleAuthUrl) {
      return NextResponse.json({ error: "No authorization URL returned" }, { status: 502 });
    }
  } catch (err) {
    console.error("[salescode-auth] initiate error:", err);
    return NextResponse.json({ error: "Salescode auth unavailable" }, { status: 502 });
  }

  const response = NextResponse.redirect(googleAuthUrl);
  // Store redirectBack in a short-lived cookie so the callback page knows where to go.
  response.cookies.set("salescode_redirect_back", redirectBack, {
    httpOnly: false, // needs to be readable by client JS in the callback page
    maxAge: 300, // 5 minutes
    path: "/",
    sameSite: "lax",
  });
  return response;
}
