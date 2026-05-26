import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
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
 * The DB uses email as the primary key (`users.id` = email), so we resolve
 * Clerk's userId → email → DB row. Auto-syncs the user on first login if the
 * webhook hasn't fired yet. Returns null if not authenticated or if the email
 * domain is not allowed.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const clerkUser = await currentUser();
  const email =
    clerkUser?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? null;

  if (!email || !email.endsWith(ALLOWED_DOMAIN)) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, email))
    .limit(1);

  if (user) {
    return { id: user.id, email: user.email, role: user.role as UserRole };
  }

  // Not in DB yet — webhook may not have fired. Try to auto-sync.
  await syncClerkUser({ clerkId: userId, email });
  return { id: email, email, role: "USER" };
}

/**
 * Requires the user to be authenticated and present in our DB.
 * - Not authenticated in Clerk → /sign-in
 * - Authenticated in Clerk but not in DB / wrong domain → /unauthorized
 */
export async function requireAuth(): Promise<AuthUser> {
  await connection();
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
 * Syncs a Clerk user to our database. Email is the primary key
 * (the Clerk user ID is no longer stored). Called from the Clerk webhook
 * handler and as a first-login fallback.
 */
export async function syncClerkUser(params: {
  clerkId: string;
  email: string;
}): Promise<void> {
  const email = params.email.toLowerCase();
  await db
    .insert(users)
    .values({ id: email, email, role: "USER" })
    .onConflictDoNothing();
}

/**
 * Returns the Clerk user's primary email address.
 */
export async function getClerkUserEmail(): Promise<string | null> {
  const clerkUser = await currentUser();
  return clerkUser?.emailAddresses?.[0]?.emailAddress ?? null;
}
