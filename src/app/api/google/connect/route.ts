import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAuth } from "@/lib/auth/server";
import { buildAuthUrl } from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = request.nextUrl;
  const redirectBack = searchParams.get("redirectBack") ?? "/settings";

  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    maxAge: 300,
    path: "/",
    sameSite: "lax",
  });
  // Bind the in-flight OAuth flow to the user who started it. The callback
  // verifies this against requireAuth() to prevent a victim who is logged
  // in from completing an attacker's consent flow and silently linking the
  // attacker's Google account to the victim's app account.
  response.cookies.set("google_oauth_user", user.id, {
    httpOnly: true,
    maxAge: 300,
    path: "/",
    sameSite: "lax",
  });
  response.cookies.set("google_redirect_back", redirectBack, {
    httpOnly: true,
    maxAge: 300,
    path: "/",
    sameSite: "lax",
  });
  return response;
}
