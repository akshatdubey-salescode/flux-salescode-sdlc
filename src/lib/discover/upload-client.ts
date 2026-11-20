// Browser side of the image upload flow (ADR-0004): start → send bytes → verify.

import { IMAGE_MAX_BYTES, isAllowedImageType } from "./core";

type UploadTarget =
  | { kind: "imagekit"; url: string; fields: Record<string, string> }
  | { kind: "local"; url: string };

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  return new Error(data?.error ?? data?.message ?? `${fallback} (${res.status})`);
}

/** Uploads one image for a showcase; resolves to its id and stable app URL. */
export async function uploadShowcaseImage(showcaseId: string, file: File): Promise<{ id: string; url: string }> {
  if (!isAllowedImageType(file.type)) throw new Error(`${file.name}: only PNG, JPEG, WebP or GIF images are allowed.`);
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`${file.name} is larger than 5 MB.`);

  const start = await fetch("/api/discover/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showcaseId, contentType: file.type, size: file.size }),
  });
  if (!start.ok) throw await errorOf(start, "Could not start the upload");
  const { id, url, upload } = (await start.json()) as { id: string; url: string; upload: UploadTarget };

  let fileId: string | null = null;
  if (upload.kind === "imagekit") {
    const form = new FormData();
    for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
    form.append("file", file);
    const res = await fetch(upload.url, { method: "POST", body: form });
    if (!res.ok) throw await errorOf(res, "Upload failed");
    fileId = ((await res.json()) as { fileId?: string }).fileId ?? null;
  } else {
    const res = await fetch(upload.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw await errorOf(res, "Upload failed");
  }

  const done = await fetch(`/api/discover/images/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!done.ok) throw await errorOf(done, "Could not verify the upload");
  return { id, url };
}
