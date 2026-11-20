import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOwnershipBody, parseTicketPatch } from "./validate";

const now = new Date("2026-11-20T10:00:00Z");

test("patch: valid full body", () => {
  const r = parseTicketPatch(
    { category: "bug", firstRespondedAt: "2026-11-20T09:00:00Z", usersReported: 3, usersImpacted: 0, eta: "2026-11-25" },
    now,
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.category, "bug");
    assert.equal(r.value.firstRespondedAt?.toISOString(), "2026-11-20T09:00:00.000Z");
  }
});
test("patch: nulls allowed, only present keys returned", () => {
  const r = parseTicketPatch({ category: null, eta: null }, now);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { category: null, eta: null });
});
test("patch: rejects bad input", () => {
  for (const b of [
    null,
    [],
    { foo: 1 },
    { category: "nope" },
    { usersReported: -1 },
    { usersReported: 1.5 },
    { usersImpacted: "3" },
    { firstRespondedAt: "yesterday" },
    { firstRespondedAt: "2026-11-20T10:05:00Z" },
    { eta: "2026-02-30" },
    { eta: "20/11/2026" },
  ]) {
    assert.equal(parseTicketPatch(b, now).ok, false, JSON.stringify(b));
  }
});
test("patch: firstRespondedAt within 1 minute slack ok", () => {
  assert.ok(parseTicketPatch({ firstRespondedAt: "2026-11-20T10:00:30Z" }, now).ok);
});
test("ownership: defaults at to now", () => {
  const r = parseOwnershipBody({ side: "client" }, now);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.at, now);
});
test("ownership: rejects bad side / at / extra keys", () => {
  for (const b of [null, {}, { side: "x" }, { side: "client", at: "nope" }, { side: "client", extra: 1 }]) {
    assert.equal(parseOwnershipBody(b, now).ok, false, JSON.stringify(b));
  }
});
