import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { type UserRole, hasMinRole } from "./types";

const ALLOWED_DOMAIN = "@salescode.ai";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

/**
 * Returns the current authenticated user with their DB role.
 * If the user is authenticated in Clerk but missing from our DB (e.g. webhook
 * delay on first login), auto-syncs them so the first request never fails.
 * Returns null if not authenticated or if their email domain is not allowed.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user) {
    return { id: user.id, email: user.email, role: user.role as UserRole };
  }

  // Not in DB yet — webhook may not have fired. Try to auto-sync.
  const clerkUser = await currentUser();
  const primaryEmail = clerkUser?.emailAddresses?.[0]?.emailAddress ?? null;

  if (!primaryEmail || !primaryEmail.endsWith(ALLOWED_DOMAIN)) {
    return null; // Domain not allowed — caller decides where to redirect
  }

  await syncClerkUser({ clerkId: userId, email: primaryEmail });
  return { id: userId, email: primaryEmail, role: "USER" };
}

/**
 * Requires the user to be authenticated and present in our DB.
 * - Not authenticated in Clerk → /sign-in
 * - Authenticated in Clerk but not in DB / wrong domain → /unauthorized
 */
export async function requireAuth(): Promise<AuthUser> {
  const { userId } = await auth();

  if (!userId) redirect("/sign-in");

  const user = await getCurrentUser();

  // userId exists (Clerk session valid) but user not in DB = wrong domain
  if (!user) redirect("/unauthorized");

  return user;
}

/**
 * Requires the current user to have at least `minRole`.
 * Redirects to /home if role is insufficient.
 */
export async function requireRole(minRole: UserRole): Promise<AuthUser> {
  const user = await requireAuth();
  if (!hasMinRole(user.role, minRole)) {
    redirect("/home?error=forbidden");
  }
  return user;
}

/**
 * Syncs a Clerk user to our database.
 * Creates the user with default USER role if they don't exist.
 * Called from the Clerk webhook handler and as a first-login fallback.
 */
export async function syncClerkUser(params: {
  clerkId: string;
  email: string;
}): Promise<void> {
  await db
    .insert(users)
    .values({ id: params.clerkId, email: params.email, role: "USER" })
    .onConflictDoNothing();
}

/**
 * Returns the Clerk user's primary email address.
 */
export async function getClerkUserEmail(): Promise<string | null> {
  const clerkUser = await currentUser();
  return clerkUser?.emailAddresses?.[0]?.emailAddress ?? null;
}
