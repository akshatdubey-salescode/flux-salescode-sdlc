import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { imagekitSignedUrl, imagekitUploadToken, sniffImageType, VIEW_TTL_SECONDS } from "./storage";

const KEY = "private_test_key";

test("v2 upload token is an HS256 JWT pinning every upload param", () => {
  const now = 1_800_000_000;
  const params = { fileName: "a.png", folder: "/discover/s1", isPrivateFile: "true", useUniqueFileName: "false", overwriteFile: "false" };
  const jwt = imagekitUploadToken("public_k", KEY, params, now);
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "HS256", typ: "JWT", kid: "public_k" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(payload, { ...params, iat: now, exp: payload.exp });
  assert.ok(Number.isInteger(payload.exp) && payload.exp > now && payload.exp - now <= 3600);
  assert.equal(sig, createHmac("sha256", KEY).update(`${h}.${p}`).digest("base64url"));
});

test("signed view URL signs the path relative to the endpoint plus expiry", () => {
  const now = 1_800_000_000;
  const url = new URL(imagekitSignedUrl(KEY, "https://ik.imagekit.io/acme/", "/discover/s1/img.png", now));
  assert.equal(url.origin + url.pathname, "https://ik.imagekit.io/acme/discover/s1/img.png");
  const t = Number(url.searchParams.get("ik-t"));
  assert.ok(t >= now + VIEW_TTL_SECONDS && t < now + VIEW_TTL_SECONDS + 600);
  assert.equal(url.searchParams.get("ik-s"), createHmac("sha1", KEY).update("discover/s1/img.png" + t).digest("hex"));
});

test("signed view URLs are stable within an expiry bucket (cacheable)", () => {
  const a = imagekitSignedUrl(KEY, "https://ik.imagekit.io/acme", "/a/b.png", 1_800_000_001);
  const b = imagekitSignedUrl(KEY, "https://ik.imagekit.io/acme", "/a/b.png", 1_800_000_060);
  assert.equal(a, b);
});

test("sniffImageType recognises raster formats and rejects others", () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(Buffer.from("<svg xmlns=...")), null);
});
