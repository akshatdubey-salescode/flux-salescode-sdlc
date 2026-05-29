import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths excluded at the matcher level (api/auth, api/webhooks, api/cron,
// api/atlassian/callback, _next/*, static assets) never invoke the proxy.
// These regexes only handle paths the matcher *does* let through that
// shouldn't be auth-gated.
const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/sign-in(\/.*)?$/,
  /^\/unauthorized$/,
  /^\/privacy$/,
  /^\/terms$/,
];

const AUTH_PATHS: RegExp[] = [/^\/sign-in(\/.*)?$/];

function matches(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(pathname));
}

// Optimistic auth check: presence of NextAuth's session cookie. The real
// session validation (signature + DB lookup) happens in (app)/layout.tsx
// via requireAuth(). We don't decode the JWT here because the proxy runs
// on Edge and any secret/runtime mismatch would silently fail the decode,
// trapping signed-in users in a /sign-in redirect loop.
function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("__Secure-next-auth.session-token") ||
    request.cookies.has("next-auth.session-token")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthed = hasSessionCookie(request);

  if (isAuthed && matches(pathname, AUTH_PATHS)) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  if (matches(pathname, PUBLIC_PATHS)) return NextResponse.next();

  if (!isAuthed) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|api/webhooks|api/cron|api/atlassian/callback|_next/static|_next/image|_next/data|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)",
  ],
};
