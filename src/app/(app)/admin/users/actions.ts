"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { UserRole } from "@/lib/auth/types";

export type UpdateRolesResult = {
  error?: string;
  success?: boolean;
};

export async function updateUserRoles(
  updates: { id: string; role: UserRole }[]
): Promise<UpdateRolesResult> {
  const actor = await requireRole("SUPERUSER");

  if (!updates.length) return { success: true };

  // Prevent the acting superuser from demoting themselves
  const selfUpdate = updates.find((u) => u.id === actor.id);
  if (selfUpdate && selfUpdate.role !== "SUPERUSER") {
    return { error: "You cannot change your own role." };
  }

  await Promise.all(
    updates.map(({ id, role }) =>
      db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, id))
    )
  );

  revalidatePath("/admin/users");
  return { success: true };
}
