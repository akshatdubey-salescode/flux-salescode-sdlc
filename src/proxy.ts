import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/sign-in(\/.*)?$/,
  /^\/unauthorized$/,
  /^\/privacy$/,
  /^\/terms$/,
  /^\/api\/auth(\/.*)?$/,
  /^\/api\/atlassian\/callback$/,
  /^\/api\/webhooks(\/.*)?$/,
  /^\/api\/cron(\/.*)?$/,
];

const AUTH_PATHS: RegExp[] = [/^\/sign-in(\/.*)?$/];

function matches(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(pathname));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = await getToken({
    req: request,
    secret: process.env.GLOBAL_AUTH_SECRET,
  });
  const isAuthed = !!token?.email;

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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
