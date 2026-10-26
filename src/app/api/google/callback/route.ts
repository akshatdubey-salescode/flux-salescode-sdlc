import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import {
  exchangeCode,
  getGoogleIdentity,
  saveIntegration,
} from "@/lib/google/oauth";
import { userMeetingsTag } from "@/lib/google/cache-tags";
import { hasMinRole } from "@/lib/auth/types";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/constants";
import { saveSharedReader, SHEETS_SCOPE } from "@/lib/google/shared-reader";
import { pinnedSheetsReaderEmail } from "@/lib/google/oauth";

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

  const sharedMode = request.cookies.get("google_oauth_mode")?.value === "shared";
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    // The shared Sheets reader is connected through its own OAuth client when one is configured.
    tokens = await exchangeCode(code, sharedMode ? "sheets" : "app");
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

  // Shared mode: store this account as the one Flux reads Sheets with, instead of linking it to the person's login.
  if (sharedMode) {
    const back = new URL(redirectBack, request.nextUrl.origin);
    const fail = (reason: string) => {
      back.searchParams.set("shared_reader_error", reason);
      const r = NextResponse.redirect(back);
      clearCookies(r);
      return r;
    };
    if (!hasMinRole(user.role, "ADMIN")) return fail("Only an admin can connect the shared Google account.");
    if (!identity.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) return fail(`The shared account must be a ${ALLOWED_EMAIL_DOMAIN} Google account.`);
    const pinned = pinnedSheetsReaderEmail();
    if (pinned && identity.email.toLowerCase() !== pinned) return fail(`Sign in as ${pinned}. This Flux is set up to read Sheets with that account only.`);
    if (!(tokens.scope ?? "").split(" ").includes(SHEETS_SCOPE)) return fail("Google Sheets access was not granted. Connect again and tick the Sheets permission.");
    if (!tokens.refresh_token) return fail("Google did not return a long-lived token. Remove Flux from that account's connected apps and connect again.");
    await saveSharedReader({ email: identity.email, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in, scopes: tokens.scope, connectedBy: user.email });
    back.searchParams.set("connected", "shared-reader");
    const ok = NextResponse.redirect(back);
    clearCookies(ok);
    return ok;
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
  response.cookies.delete("google_oauth_mode");
  response.cookies.delete("google_redirect_back");
}
