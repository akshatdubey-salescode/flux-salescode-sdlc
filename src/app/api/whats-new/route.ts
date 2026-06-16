import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import {
  getPublishedReleaseNotes,
  getSeenNoteIds,
  markReleaseNotesSeen,
} from "@/lib/release-notes/queries";

// Published "What's New" notes plus the ids this user has already seen.
export async function GET() {
  const user = await requireAuth();
  const [notes, seenIds] = await Promise.all([
    getPublishedReleaseNotes(),
    getSeenNoteIds(user.id),
  ]);
  return NextResponse.json({ notes, seenIds });
}

// Mark notes as seen for this user. Body: { ids: string[] }.
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: true });

  // Guard against FK violations from ids that no longer exist / aren't public.
  const published = new Set(
    (await getPublishedReleaseNotes()).map((n) => n.id)
  );
  await markReleaseNotesSeen(
    user.id,
    ids.filter((id) => published.has(id))
  );
  return NextResponse.json({ ok: true });
}
