// Unit tests for signAppJwt — the pure JWT-construction half of GitHub App
// auth. The installation-token exchange itself needs a real App + network
// call and isn't covered here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "crypto";
import { signAppJwt, isTokenFresh, type CachedToken } from "./app-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

test("produces a well-formed 3-part JWT", () => {
  const jwt = signAppJwt("12345", privateKey);
  assert.equal(jwt.split(".").length, 3);
});

test("header declares RS256/JWT", () => {
  const [headerPart] = signAppJwt("12345", privateKey).split(".");
  assert.deepEqual(decodePart(headerPart), { alg: "RS256", typ: "JWT" });
});

test("payload carries iss=appId and a 9-minute exp window", () => {
  const now = 1_800_000_000_000; // fixed instant, deterministic
  const [, payloadPart] = signAppJwt("999", privateKey, now).split(".");
  const payload = decodePart(payloadPart) as { iat: number; exp: number; iss: string };
  assert.equal(payload.iss, "999");
  assert.equal(payload.exp - payload.iat, 9 * 60);
});

test("iat is backdated ~60s from now to tolerate clock drift", () => {
  const now = 1_800_000_000_000;
  const [, payloadPart] = signAppJwt("1", privateKey, now).split(".");
  const payload = decodePart(payloadPart) as { iat: number };
  assert.equal(Math.floor(now / 1000) - payload.iat, 60);
});

test("signature verifies against the matching public key", () => {
  const jwt = signAppJwt("42", privateKey);
  const [headerPart, payloadPart, sigPart] = jwt.split(".");
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = Buffer.from(sigPart.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  assert.equal(verifier.verify(publicKey, signature), true);
});

test("signature does NOT verify against a different key pair", () => {
  const other = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const jwt = signAppJwt("42", privateKey);
  const [headerPart, payloadPart, sigPart] = jwt.split(".");
  const signature = Buffer.from(sigPart.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  assert.equal(verifier.verify(other.publicKey, signature), false);
});

test("different appId or instant produces a different token", () => {
  const a = signAppJwt("100", privateKey, 1_800_000_000_000);
  const b = signAppJwt("200", privateKey, 1_800_000_000_000);
  const c = signAppJwt("100", privateKey, 1_800_000_100_000);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

// isTokenFresh — the cache-vs-refresh decision getInstallationToken relies on.
const FIVE_MIN_MS = 5 * 60 * 1000;

test("no cached token → never fresh", () => {
  assert.equal(isTokenFresh(undefined, 1_800_000_000_000), false);
});

test("well inside the buffer (expires in 10 minutes) → fresh", () => {
  const now = 1_800_000_000_000;
  const cached: CachedToken = { token: "t", expiresAtMs: now + 10 * 60 * 1000 };
  assert.equal(isTokenFresh(cached, now), true);
});

test("inside the 5-minute buffer (expires in 2 minutes) → NOT fresh, must refresh", () => {
  const now = 1_800_000_000_000;
  const cached: CachedToken = { token: "t", expiresAtMs: now + 2 * 60 * 1000 };
  assert.equal(isTokenFresh(cached, now), false);
});

test("exactly at the buffer boundary → not fresh (strictly greater-than, inclusive of the edge failing safe)", () => {
  const now = 1_800_000_000_000;
  const cached: CachedToken = { token: "t", expiresAtMs: now + FIVE_MIN_MS };
  assert.equal(isTokenFresh(cached, now), false);
});

test("already expired token → not fresh", () => {
  const now = 1_800_000_000_000;
  const cached: CachedToken = { token: "t", expiresAtMs: now - 1000 };
  assert.equal(isTokenFresh(cached, now), false);
});
