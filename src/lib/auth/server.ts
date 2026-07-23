import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db, withDbRetry } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { authOptions } from "./nextauth-options";
import { ALLOWED_EMAIL_DOMAIN } from "./constants";
import { type UserRole, hasMinRole } from "./types";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  canManageDeliveries: boolean;
};

/**
 * Returns the current authenticated user with their DB role.
 * Returns null if not authenticated or if the email domain is not allowed.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !email.endsWith(ALLOWED_EMAIL_DOMAIN)) return null;

  // Wrap the DB reads/writes so a transient connection blip to the remote DB
  // (idle socket reaped, network hiccup, connect timeout) doesn't crash the
  // app shell — requireAuth runs in the root layout on every request.
  const [user] = await withDbRetry(() =>
    db.select().from(users).where(eq(users.id, email)).limit(1)
  );

  if (user) {
    return {
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      canManageDeliveries: user.canManageDeliveries,
    };
  }

  // Defensive fallback: the signIn callback should have inserted this row,
  // but if it didn't (e.g. transient DB error), create it now.
  await withDbRetry(() =>
    db.insert(users).values({ id: email, email, role: "USER" }).onConflictDoNothing()
  );
  return { id: email, email, role: "USER", canManageDeliveries: false };
}

/**
 * Requires the user to be authenticated and present in our DB.
 * - Not authenticated → /sign-in
 * - Wrong domain → /unauthorized
 */
export async function requireAuth(): Promise<AuthUser> {
  await connection();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/sign-in");

  const user = await getCurrentUser();
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
