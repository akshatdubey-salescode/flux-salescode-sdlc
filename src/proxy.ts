import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/unauthorized",
  "/api/webhooks(.*)",
  "/api/cron(.*)",
]);

const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export const proxy = clerkMiddleware(async (auth, request: NextRequest) => {
  const { userId } = await auth();

  // Authenticated users visiting auth pages → send to /home
  if (userId && isAuthRoute(request)) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  if (isPublicRoute(request)) return NextResponse.next();

  // Unauthenticated users visiting protected routes → send to /sign-in
  if (!userId) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
