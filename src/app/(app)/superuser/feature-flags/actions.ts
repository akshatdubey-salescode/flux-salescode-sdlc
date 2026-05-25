"use server";

import { revalidateTag } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import type { FlagKey } from "@/lib/feature-flags";
import defaultFlags from "@/lib/defaultFeatureFlags.json";

export async function updateFeatureFlag(
  key: string,
  rawValue: string
): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  if (!(key in defaultFlags)) {
    return { error: `Unknown flag key: "${key}".` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { error: "Invalid JSON value." };
  }

  await db
    .insert(featureFlags)
    .values({ key: key as FlagKey, value: parsed, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { value: parsed, updatedAt: new Date() },
    });

  revalidateTag("feature-flags", "max");
  return {};
}

export async function dropFeatureFlagsCache(): Promise<void> {
  await requireRole("SUPERUSER");
  revalidateTag("feature-flags", "max");
}
