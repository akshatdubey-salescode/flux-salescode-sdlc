"use server";

import { currentUser } from "@clerk/nextjs/server";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { featureRequests } from "@/lib/db/schema";

export type SubmitFeatureRequestState = {
  error?: string;
  success?: boolean;
};

export async function submitFeatureRequest(
  _prev: SubmitFeatureRequestState,
  formData: FormData
): Promise<SubmitFeatureRequestState> {
  const user = await requireAuth();

  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const useCaseProblem = (formData.get("useCaseProblem") as string)?.trim() || null;
  const priority = (formData.get("priority") as string) ?? "medium";

  if (!title || !description) {
    return { error: "Title and description are required." };
  }

  if (!["low", "medium", "high"].includes(priority)) {
    return { error: "Invalid priority value." };
  }

  const clerkUser = await currentUser();
  const submittedByName =
    clerkUser?.fullName ||
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    null;

  await db.insert(featureRequests).values({
    title,
    description,
    useCaseProblem,
    priority: priority as "low" | "medium" | "high",
    submittedBy: user.id,
    submittedByEmail: user.email,
    submittedByName,
  });

  return { success: true };
}
