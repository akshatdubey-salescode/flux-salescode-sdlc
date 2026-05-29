import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The proxy only guards *page* navigations (auth redirect to /sign-in and
// bounce authed users off /sign-in). The entire /api tree is excluded at the
// matcher level: every API route independently validates the session via
// requireAuth()/requireRole()/getCurrentUser() in its handler, so a proxy
// cookie-presence check there is pure redundant (billed) overhead — it never
// provided real protection (cookie present != valid session). Also excluded:
// _next/* and static assets. These regexes only handle the page paths the
// matcher *does* let through that shouldn't be auth-gated.
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
    "/((?!api|_next/static|_next/image|_next/data|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)",
  ],
};
