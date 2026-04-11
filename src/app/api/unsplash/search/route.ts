import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/server";

export type UnsplashPhoto = {
  id: string;
  thumbUrl: string;
  regularUrl: string;
  altDescription: string | null;
  photographerName: string;
  photographerUrl: string;
};

export async function GET(req: NextRequest) {
  await requireAuth();

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return Response.json(
      { error: "Unsplash integration not configured. Add UNSPLASH_ACCESS_KEY to your environment." },
      { status: 503 }
    );
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ photos: [] });
  }

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", "16");
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${key}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return Response.json({ error: "Unsplash API error" }, { status: res.status });
  }

  const data = await res.json() as {
    results: {
      id: string;
      urls: { small: string; regular: string };
      alt_description: string | null;
      user: { name: string; links: { html: string } };
    }[];
  };

  const photos: UnsplashPhoto[] = data.results.map((r) => ({
    id: r.id,
    thumbUrl: r.urls.small,
    regularUrl: r.urls.regular,
    altDescription: r.alt_description,
    photographerName: r.user.name,
    photographerUrl: r.user.links.html,
  }));

  return Response.json({ photos });
}
