// Image storage for Discover (ADR-0001, ADR-0003, ADR-0004).
//
// Production: ImageKit, as *private files* (viewable only through signed URLs).
// Configured by IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and
// IMAGEKIT_URL_ENDPOINT. Calls are hand-rolled with node:crypto + fetch (no SDK).
//   • Upload: the browser POSTs multipart to ImageKit's v2 upload API with a
//     server-signed JWT (HS256, private key). The JWT pins every upload
//     parameter (file name, folder, private flag, no overwrite), so the
//     browser can't redirect the upload elsewhere. verify() then re-reads the
//     file from ImageKit and deletes it unless it is private, ≤ 5 MB and of the
//     declared type.
//   • View: the app redirects to a short-lived signed URL (ik-t / ik-s).
//
// Dev without ImageKit: a gitignored local folder, with uploads PUT to a
// same-origin route and downloads streamed by the app. Production without
// ImageKit fails loudly instead of writing to local disk.

import { createHmac } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertSafeKey } from "@/lib/storage";
import { IMAGE_MAX_BYTES } from "./core";

/** How long a signed view URL stays valid, at minimum. */
export const VIEW_TTL_SECONDS = 10 * 60;
/** Expiries are rounded up to this, so the same URL is reused (and cached) for a while. */
const VIEW_BUCKET_SECONDS = 5 * 60;
const UPLOAD_TTL_SECONDS = 10 * 60;

const IMAGEKIT_UPLOAD_URL = "https://upload.imagekit.io/api/v2/files/upload";
const IMAGEKIT_API = "https://api.imagekit.io/v1";

export type UploadTarget =
  | { kind: "imagekit"; url: string; fields: Record<string, string> }
  | { kind: "local"; url: string };

export type StoredImage = { id: string; storageKey: string; contentType: string; providerFileId: string | null };

export type VerifyResult =
  | { ok: true; size: number; providerFileId: string | null }
  | { ok: false; status: number; error: string };

export type ImageStore = {
  kind: "imagekit" | "local";
  /** Where and how the browser sends the bytes for this image. */
  uploadTarget(img: StoredImage): UploadTarget;
  /**
   * Checks what actually landed in storage. `providerFileId` is the id the
   * upload API returned to the browser (ImageKit only). On failure the stored
   * file has already been deleted.
   */
  verify(img: StoredImage, providerFileId: string | null): Promise<VerifyResult>;
  /** Signed view URL, or null when the app must stream the bytes itself (local). */
  viewUrl(img: StoredImage, now?: Date): string | null;
  /** Local store only. */
  read(key: string): Promise<Buffer>;
  /** Local store only: writes bytes received by the dev upload route. */
  write(key: string, body: Buffer): Promise<void>;
  /** A missing file is not an error. */
  delete(img: Pick<StoredImage, "storageKey" | "providerFileId">): Promise<void>;
};

export class ImageStorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Discover image storage is not configured. Set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT.",
    );
    this.name = "ImageStorageNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// ImageKit signing (pure, exported for tests)
// ---------------------------------------------------------------------------

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/**
 * v2 upload token: an HS256 JWT signed with the private key (header `kid` =
 * public key). The payload must carry every form field except `file` and
 * `token`, as strings, plus integer `iat`/`exp` (at most an hour apart).
 * ImageKit rejects the upload if the submitted fields differ, and each token
 * works once.
 */
export function imagekitUploadToken(
  publicKey: string,
  privateKey: string,
  params: Record<string, string>,
  nowSeconds: number,
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: publicKey }));
  const payload = b64url(JSON.stringify({ ...params, iat: nowSeconds, exp: nowSeconds + UPLOAD_TTL_SECONDS }));
  const sig = createHmac("sha256", privateKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/**
 * Signed URL for a private file: HMAC-SHA1(privateKey, <url minus endpoint/> + expiry),
 * appended as ?ik-t=<expiry>&ik-s=<sig>. Expiry is rounded up to a bucket so
 * repeat views within the bucket get an identical, cacheable URL.
 */
export function imagekitSignedUrl(
  privateKey: string,
  urlEndpoint: string,
  filePath: string,
  nowSeconds: number,
): string {
  const endpoint = urlEndpoint.replace(/\/+$/, "");
  const relative = filePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const expiry =
    Math.ceil((nowSeconds + VIEW_TTL_SECONDS) / VIEW_BUCKET_SECONDS) * VIEW_BUCKET_SECONDS;
  const sig = createHmac("sha1", privateKey).update(relative + expiry).digest("hex");
  return `${endpoint}/${relative}?ik-t=${expiry}&ik-s=${sig}`;
}

function splitPath(filePath: string): { folder: string; fileName: string } {
  const i = filePath.lastIndexOf("/");
  return { folder: filePath.slice(0, i) || "/", fileName: filePath.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

type ImageKitFileDetails = {
  fileId: string;
  filePath: string;
  size: number;
  mime?: string;
  isPrivateFile?: boolean;
};

function imagekitStore(publicKey: string, privateKey: string, urlEndpoint: string): ImageStore {
  const auth = `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`;

  async function deleteFile(fileId: string) {
    const res = await fetch(`${IMAGEKIT_API}/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: auth },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`ImageKit delete failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
  }

  return {
    kind: "imagekit",
    uploadTarget(img) {
      const { folder, fileName } = splitPath(img.storageKey);
      const params = {
        fileName,
        folder,
        isPrivateFile: "true",
        useUniqueFileName: "false",
        overwriteFile: "false",
      };
      return {
        kind: "imagekit",
        url: IMAGEKIT_UPLOAD_URL,
        fields: { ...params, token: imagekitUploadToken(publicKey, privateKey, params, Math.floor(Date.now() / 1000)) },
      };
    },
    async verify(img, providerFileId) {
      if (!providerFileId || !/^[A-Za-z0-9_-]+$/.test(providerFileId)) {
        return { ok: false, status: 400, error: "The upload did not complete. Please try again." };
      }
      const res = await fetch(`${IMAGEKIT_API}/files/${providerFileId}/details`, {
        headers: { Authorization: auth },
        cache: "no-store",
      });
      if (res.status === 404) return { ok: false, status: 400, error: "The upload did not reach storage. Please try again." };
      if (!res.ok) throw new Error(`ImageKit file details failed (${res.status})`);
      const f = (await res.json()) as ImageKitFileDetails;

      // Only ever delete a file at *this* image's path. A fileId pointing
      // anywhere else is rejected untouched, so verify can't be used to delete
      // someone else's file.
      if (f.filePath !== img.storageKey) {
        return { ok: false, status: 400, error: "The upload was not stored as expected. Please try again." };
      }
      let problem: { status: number; error: string } | null = null;
      if (f.isPrivateFile !== true) {
        problem = { status: 400, error: "The upload was not stored as expected. Please try again." };
      } else if (f.size > IMAGE_MAX_BYTES) {
        problem = { status: 413, error: "Images must be 5 MB or smaller." };
      } else if (f.mime !== img.contentType) {
        problem = { status: 415, error: "That file is not a valid PNG, JPEG, WebP or GIF image." };
      }
      if (problem) {
        await deleteFile(f.fileId).catch((err) => console.error("[discover] cleanup after bad upload failed:", err));
        return { ok: false, ...problem };
      }
      return { ok: true, size: f.size, providerFileId: f.fileId };
    },
    viewUrl(img, now = new Date()) {
      return imagekitSignedUrl(privateKey, urlEndpoint, img.storageKey, Math.floor(now.getTime() / 1000));
    },
    async read() {
      throw new Error("Not supported on ImageKit; use viewUrl.");
    },
    async write() {
      throw new Error("Not supported on ImageKit; the browser uploads directly.");
    },
    async delete(img) {
      // Without a fileId the upload never completed verification; nothing we can address.
      if (img.providerFileId) await deleteFile(img.providerFileId);
    },
  };
}

const LOCAL_ROOT = path.join(process.cwd(), ".discover-storage");

function localStore(): ImageStore {
  const resolve = (key: string) => {
    const rel = key.replace(/^\/+/, "");
    assertSafeKey(rel);
    const full = path.join(LOCAL_ROOT, rel);
    if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Unsafe storage key");
    return full;
  };
  return {
    kind: "local",
    uploadTarget(img) {
      return { kind: "local", url: `/api/discover/images/${img.id}/upload` };
    },
    async verify(img) {
      let body: Buffer;
      try {
        body = await fs.readFile(resolve(img.storageKey));
      } catch {
        return { ok: false, status: 400, error: "The upload did not reach storage. Please try again." };
      }
      const reject = async (status: number, error: string): Promise<VerifyResult> => {
        await fs.rm(resolve(img.storageKey), { force: true });
        return { ok: false, status, error };
      };
      if (body.length > IMAGE_MAX_BYTES) return reject(413, "Images must be 5 MB or smaller.");
      if (sniffImageType(body) !== img.contentType) return reject(415, "That file is not a valid PNG, JPEG, WebP or GIF image.");
      return { ok: true, size: body.length, providerFileId: null };
    },
    viewUrl() {
      return null;
    },
    async read(key) {
      return fs.readFile(resolve(key));
    },
    async write(key, body) {
      const full = resolve(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
    },
    async delete(img) {
      await fs.rm(resolve(img.storageKey), { force: true });
    },
  };
}

let cached: ImageStore | null = null;

export function getImageStore(): ImageStore {
  if (cached) return cached;
  const { IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT } = process.env;
  if (IMAGEKIT_PUBLIC_KEY && IMAGEKIT_PRIVATE_KEY && IMAGEKIT_URL_ENDPOINT) {
    cached = imagekitStore(IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT);
  } else if (process.env.NODE_ENV !== "production") {
    cached = localStore();
  } else {
    throw new ImageStorageNotConfiguredError();
  }
  return cached;
}

/** Magic-byte sniff, so a renamed file can't pass as an image. */
export function sniffImageType(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
