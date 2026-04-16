import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import {
  exchangeCode,
  getAtlassianIdentity,
  saveIntegration,
} from "@/lib/atlassian/oauth";

export async function GET(request: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const redirectBack =
    request.cookies.get("atlassian_redirect_back")?.value ?? "/settings";

  // User denied access on Atlassian's consent screen
  if (error) {
    console.warn("[atlassian-oauth] OAuth error:", error);
    const url = new URL(redirectBack, request.nextUrl.origin);
    url.searchParams.set("error", "atlassian_denied");
    const response = NextResponse.redirect(url);
    clearCookies(response);
    return response;
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  // CSRF check
  const storedState = request.cookies.get("atlassian_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("[atlassian-oauth] Code exchange failed:", err);
    return NextResponse.json({ error: "Token exchange failed" }, { status: 502 });
  }

  let identity: Awaited<ReturnType<typeof getAtlassianIdentity>>;
  try {
    identity = await getAtlassianIdentity(tokens.access_token);
  } catch (err) {
    console.error("[atlassian-oauth] Identity fetch failed:", err);
    return NextResponse.json({ error: "Could not fetch Atlassian identity" }, { status: 502 });
  }

  await saveIntegration({
    userId: user.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    accountId: identity.account_id,
    email: identity.email,
  });

  const successUrl = new URL(redirectBack, request.nextUrl.origin);
  successUrl.searchParams.set("connected", "atlassian");
  const response = NextResponse.redirect(successUrl);
  clearCookies(response);
  return response;
}

function clearCookies(response: NextResponse) {
  response.cookies.delete("atlassian_oauth_state");
  response.cookies.delete("atlassian_redirect_back");
}
