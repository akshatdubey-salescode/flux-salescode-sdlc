import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import {
  exchangeCode,
  getAtlassianIdentity,
  getAccessibleResources,
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

  // Fetch identity and accessible resources in parallel
  let identity: Awaited<ReturnType<typeof getAtlassianIdentity>>;
  let resources: Awaited<ReturnType<typeof getAccessibleResources>>;
  try {
    [identity, resources] = await Promise.all([
      getAtlassianIdentity(tokens.access_token),
      getAccessibleResources(tokens.access_token),
    ]);
  } catch (err) {
    console.error("[atlassian-oauth] Post-token fetch failed:", err);
    return NextResponse.json(
      { error: "Could not fetch Atlassian account details" },
      { status: 502 }
    );
  }

  if (resources.length === 0) {
    return NextResponse.json(
      { error: "No accessible Atlassian sites found for this account" },
      { status: 422 }
    );
  }

  // Use the first accessible site's cloudId.
  // For salescode.ai this will always be the single org instance.
  const cloudId = resources[0].id;

  await saveIntegration({
    userId: user.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    accountId: identity.account_id,
    email: identity.email,
    cloudId,
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
