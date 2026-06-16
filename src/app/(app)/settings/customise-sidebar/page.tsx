import { requireAuth } from "@/lib/auth/server";
import { isEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { CustomiseSidebarClient } from "./customise-sidebar-client";

export default async function CustomiseSidebarPage() {
  const [user, requirementBuilderEnabled] = await Promise.all([
    requireAuth(),
    isEnabled(FEATURE_FLAGS.REQUIREMENT_BUILDER),
  ]);

  return (
    <CustomiseSidebarClient
      isSuperuser={user.role === "SUPERUSER"}
      requirementBuilderEnabled={requirementBuilderEnabled}
    />
  );
}
