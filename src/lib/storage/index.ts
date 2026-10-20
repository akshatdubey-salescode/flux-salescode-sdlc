// Object storage for Test Case files. Production uses a private S3 bucket
// (S3_BUCKET + S3_REGION, credentials from the standard AWS env vars); when no
// bucket is configured and we are NOT in production, files go to a gitignored
// local folder so the whole flow can be exercised without AWS. Production
// without a bucket fails loudly rather than silently writing to local disk.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** How long a download link stays valid. Short on purpose; links are minted per click. */
const DOWNLOAD_URL_TTL_SECONDS = 120;

export type Download =
  | { kind: "redirect"; url: string }
  | { kind: "bytes"; body: Buffer };

export type BlobStore = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Removes the object; a missing object is not an error. */
  delete(key: string): Promise<void>;
  download(key: string, fileName: string): Promise<Download>;
};

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File storage is not configured. Set S3_BUCKET and S3_REGION (and AWS credentials).");
    this.name = "StorageNotConfiguredError";
  }
}

/** Reject keys that could escape the store root. Keys are built by buildTcS3Key, this is the backstop. */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Unsafe storage key");
  }
}

function s3Store(bucket: string, region: string): BlobStore {
  const client = new S3Client({ region });
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: "AES256",
        }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error("Empty object");
      return Buffer.from(bytes);
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async download(key, fileName) {
      assertSafeKey(key);
      const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, "_");
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safeName}"`,
          ResponseContentType: XLSX_CONTENT_TYPE,
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
      );
      return { kind: "redirect", url };
    },
  };
}

const LOCAL_ROOT = path.join(process.cwd(), ".tc-storage");

function localStore(): BlobStore {
  const resolve = (key: string) => {
    assertSafeKey(key);
    const full = path.join(LOCAL_ROOT, key);
    if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Unsafe storage key");
    return full;
  };
  return {
    async put(key, body) {
      const full = resolve(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
    },
    async get(key) {
      return fs.readFile(resolve(key));
    },
    async delete(key) {
      await fs.rm(resolve(key), { force: true });
    },
    async download(key) {
      return { kind: "bytes", body: await fs.readFile(resolve(key)) };
    },
  };
}

let cached: BlobStore | null = null;

export function getStore(): BlobStore {
  if (cached) return cached;
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  if (bucket && region) {
    cached = s3Store(bucket, region);
  } else if (process.env.NODE_ENV !== "production") {
    cached = localStore();
  } else {
    throw new StorageNotConfiguredError();
  }
  return cached;
}
