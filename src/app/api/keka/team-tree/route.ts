import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { loadKekaDirectory, type TeamTreeNode } from "@/lib/keka/directory";

// Full downward org subtree rooted at `rootEmail` (that person plus every
// direct/indirect report), for the Availability Finder's Team-tab picker.
// `found:false` means the root email isn't a current Keka employee — callers
// should fall back to whatever flat membership they already had, not treat
// this as an error.
export type TeamTreeResponse =
  | { found: true; root: TeamTreeNode }
  | { found: false; root: null };

export async function GET(request: Request) {
  await requireAuth();
  const url = new URL(request.url);
  const rootEmail = url.searchParams.get("rootEmail")?.toLowerCase() ?? null;

  const dir = await loadKekaDirectory();
  const root = dir.subtree(rootEmail);

  const body: TeamTreeResponse = root ? { found: true, root } : { found: false, root: null };
  return NextResponse.json(body);
}
