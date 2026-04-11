import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/server";

export type ImageSearchResult = {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  tags: string;
  author: string;
};

export async function GET(req: NextRequest) {
  await requireAuth();

  const key = process.env.PIXABAY_API_KEY;
  if (!key) {
    return Response.json(
      {
        error:
          "Image search not configured. Add PIXABAY_API_KEY to your environment (free at pixabay.com/api/docs).",
      },
      { status: 503 }
    );
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ results: [] });
  }

  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", q);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("orientation", "horizontal");
  url.searchParams.set("per_page", "16");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("min_width", "1280");

  const res = await fetch(url.toString(), {
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return Response.json({ error: "Image search failed" }, { status: res.status });
  }

  const data = await res.json() as {
    hits: {
      id: number;
      previewURL: string;
      webformatURL: string;
      largeImageURL: string;
      tags: string;
      user: string;
    }[];
  };

  const results: ImageSearchResult[] = data.hits.map((h) => ({
    id: String(h.id),
    thumbUrl: h.previewURL,
    fullUrl: h.largeImageURL || h.webformatURL,
    tags: h.tags,
    author: h.user,
  }));

  return Response.json({ results });
}
