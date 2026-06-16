import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getPublishedReleaseNotes } from "@/lib/release-notes/queries";

// Published "What's New" notes for the signed-in user's notification bell.
export async function GET() {
  await requireAuth();
  const notes = await getPublishedReleaseNotes();
  return NextResponse.json({ notes });
}
