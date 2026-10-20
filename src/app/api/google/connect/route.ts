import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAuth } from "@/lib/auth/server";
import { buildAuthUrl, OPTIONAL_SCOPES, type OptionalScopeName } from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = request.nextUrl;
  // Only same-site paths: "/x" is fine, "//evil.example" and absolute URLs are not.
  const requestedBack = searchParams.get("redirectBack");
  const redirectBack =
    requestedBack && requestedBack.startsWith("/") && !requestedBack.startsWith("//")
      ? requestedBack
      : "/settings";
  // Optional feature scopes, e.g. ?scopes=sheets (unknown names are ignored).
  const extraScopes = (searchParams.get("scopes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OptionalScopeName => s in OPTIONAL_SCOPES);

  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(state, extraScopes);

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
