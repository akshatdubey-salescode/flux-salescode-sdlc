import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import {
  exchangeCode,
  getGoogleIdentity,
  saveIntegration,
} from "@/lib/google/oauth";
import { userMeetingsTag } from "@/lib/google/cache-tags";

export async function GET(request: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const redirectBack =
    request.cookies.get("google_redirect_back")?.value ?? "/settings";

  if (error) {
    console.warn("[google-oauth] OAuth error:", error);
    const url = new URL(redirectBack, request.nextUrl.origin);
    url.searchParams.set("error", "google_denied");
    const response = NextResponse.redirect(url);
    clearCookies(response);
    return response;
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const storedState = request.cookies.get("google_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  // Refuse the callback if the authenticated user differs from the one who
  // started the flow. Without this check, a victim who is logged in and
  // visits the callback URL after an attacker has primed cookies would
  // silently link the attacker's Google identity to the victim's account.
  const storedUserId = request.cookies.get("google_oauth_user")?.value;
  if (!storedUserId || storedUserId !== user.id) {
    return NextResponse.json(
      { error: "OAuth session does not match the authenticated user" },
      { status: 400 }
    );
  }

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("[google-oauth] Code exchange failed:", err);
    return NextResponse.json({ error: "Token exchange failed" }, { status: 502 });
  }

  let identity: Awaited<ReturnType<typeof getGoogleIdentity>>;
  try {
    identity = await getGoogleIdentity(tokens.access_token);
  } catch (err) {
    console.error("[google-oauth] Identity fetch failed:", err);
    return NextResponse.json(
      { error: "Could not fetch Google account details" },
      { status: 502 }
    );
  }

  await saveIntegration({
    userId: user.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    googleEmail: identity.email,
  });

  // Reconnecting clears the syncToken (see saveIntegration), so cached
  // "no events" responses for this user are now stale even before the
  // first cron tick.
  revalidateTag(userMeetingsTag(user.id), "max");

  const successUrl = new URL(redirectBack, request.nextUrl.origin);
  successUrl.searchParams.set("connected", "google");
  const response = NextResponse.redirect(successUrl);
  clearCookies(response);
  return response;
}

function clearCookies(response: NextResponse) {
  response.cookies.delete("google_oauth_state");
  response.cookies.delete("google_oauth_user");
  response.cookies.delete("google_redirect_back");
}
