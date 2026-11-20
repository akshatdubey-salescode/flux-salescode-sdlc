import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { isValidUuid } from "@/lib/validation";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { getSettings, listSupportTickets } from "@/lib/support/store";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  const [tickets, settings] = await Promise.all([listSupportTickets(id), getSettings(id)]);
  return NextResponse.json({
    tickets,
    settings: {
      supportLabel: settings.supportLabel,
      enabled: settings.enabled,
      officeHours: settings.officeHours,
    },
  });
}
