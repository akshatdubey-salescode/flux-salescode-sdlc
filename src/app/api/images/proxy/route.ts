import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/server";

export async function GET(req: NextRequest) {
  await requireAuth();

  const url = req.nextUrl.searchParams.get("url");
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return new Response("Invalid URL", { status: 400 });
  }

  const upstream = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!upstream.ok) {
    return new Response("Failed to fetch image", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return new Response("Not an image", { status: 400 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
