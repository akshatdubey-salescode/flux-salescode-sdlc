import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { loadKekaDirectory, tenureDays } from "@/lib/keka/directory";

// Keka org context for one person, by work email. With no `email` param it
// answers for the signed-in user (so "My Tasks" can show its own header).
// `found:false` means the email isn't a current Keka employee — callers should
// render nothing rather than an empty card.
export type KekaProfile = {
  found: boolean;
  email: string;
  displayName: string | null;
  jobTitle: string | null;
  department: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerChain: string[];
  tenureDays: number | null;
};

export async function GET(request: Request) {
  const me = await requireAuth();
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? me.email).toLowerCase();

  const dir = await loadKekaDirectory();
  const e = dir.get(email);

  const profile: KekaProfile = {
    found: e !== undefined,
    email,
    displayName: e?.displayName ?? null,
    jobTitle: e?.jobTitle ?? null,
    department: e?.department ?? null,
    managerName: e?.managerName ?? null,
    managerEmail: e?.managerEmail ?? null,
    managerChain: dir.managerChain(email),
    tenureDays: tenureDays(e?.joiningDate ?? null),
  };
  return NextResponse.json(profile);
}
