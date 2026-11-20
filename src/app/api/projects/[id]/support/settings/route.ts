import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/server";
import { getSettings, saveSettings } from "@/lib/support/store";
import { parseSettingsBody } from "@/lib/support/validate";
import { guardProject } from "@/lib/support/route-guard";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  const blocked = await guardProject(id);
  if (blocked) return blocked;
  return NextResponse.json(await getSettings(id));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireRole("ADMIN");
  const { id } = await params;
  const blocked = await guardProject(id);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseSettingsBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await saveSettings(id, parsed.value, user.id);
  return NextResponse.json(await getSettings(id));
}
