import assert from "node:assert/strict";
import { test } from "node:test";
import { isBeforeTicketCreated, parseOwnershipBody, parseSettingsBody, parseTicketPatch } from "./validate";

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

// ---- parseSettingsBody ----

const goodSettings = () => ({
  enabled: true,
  supportLabel: "  support ",
  periodMode: "mtd",
  periodStart: null,
  toEmails: [" A@x.com ", "a@x.com", "b@y.org"],
  ccEmails: ["C@z.io"],
  approverUserIds: ["User-1", "boss@x.com"],
  sharedBy: " L2 Support ",
  sla: {
    P1: { responseMin: 10, resolutionMin: 240 },
    P2: { responseMin: 10, resolutionMin: 480 },
    P3: { responseMin: 30, resolutionMin: 1440 },
    P4: { responseMin: 30, resolutionMin: 2400 },
  },
  officeHours: { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5] },
});

test("settings: valid body is normalised", () => {
  const r = parseSettingsBody(goodSettings());
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.supportLabel, "support");
    assert.equal(r.value.sharedBy, "L2 Support");
    assert.deepEqual(r.value.toEmails, ["a@x.com", "b@y.org"]);
    assert.deepEqual(r.value.ccEmails, ["c@z.io"]);
    assert.deepEqual(r.value.approverUserIds, ["user-1", "boss@x.com"]);
  }
});

test("settings: rejects non-object, empty label, empty sharedBy", () => {
  assert.equal(parseSettingsBody(null).ok, false);
  assert.equal(parseSettingsBody([]).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), supportLabel: "  " }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), sharedBy: "" }).ok, false);
});

test("settings: email validation", () => {
  assert.equal(parseSettingsBody({ ...goodSettings(), toEmails: ["nope"] }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), ccEmails: ["a b@x.com"] }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), toEmails: "a@x.com" }).ok, false);
});

test("settings: enabled requires a To; disabled does not", () => {
  assert.equal(parseSettingsBody({ ...goodSettings(), toEmails: [] }).ok, false);
  assert.ok(parseSettingsBody({ ...goodSettings(), enabled: false, toEmails: [] }).ok);
});

test("settings: periodMode", () => {
  assert.equal(parseSettingsBody({ ...goodSettings(), periodMode: "weekly" }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), periodMode: "custom", periodStart: null }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), periodMode: "custom", periodStart: "2026-02-30" }).ok, false);
  const c = parseSettingsBody({ ...goodSettings(), periodMode: "custom", periodStart: "2026-04-01" });
  assert.ok(c.ok);
  if (c.ok) assert.equal(c.value.periodStart, "2026-04-01");
  const m = parseSettingsBody({ ...goodSettings(), periodMode: "ytd", periodStart: "2026-04-01" });
  assert.ok(m.ok);
  if (m.ok) assert.equal(m.value.periodStart, null);
});

test("settings: SLA values", () => {
  const bad = (mut: (s: ReturnType<typeof goodSettings>) => void) => {
    const s = goodSettings();
    mut(s);
    return parseSettingsBody(s).ok;
  };
  assert.equal(bad((s) => { s.sla.P1.responseMin = 0; }), false);
  assert.equal(bad((s) => { s.sla.P2.resolutionMin = 1.5; }), false);
  assert.equal(bad((s) => { s.sla.P3.resolutionMin = -5; }), false);
  assert.equal(bad((s) => { delete (s.sla as Record<string, unknown>).P4; }), false);
  assert.equal(bad((s) => { (s.sla.P1 as Record<string, unknown>).responseMin = "10"; }), false);
});

test("settings: office hours", () => {
  const oh = (o: unknown) => parseSettingsBody({ ...goodSettings(), officeHours: o }).ok;
  assert.ok(oh({ start: "00:00", end: "24:00", days: [0, 6] }));
  assert.equal(oh({ start: "10:00", end: "10:00", days: [1] }), false);
  assert.equal(oh({ start: "19:00", end: "10:00", days: [1] }), false);
  assert.equal(oh({ start: "24:00", end: "24:00", days: [1] }), false);
  assert.equal(oh({ start: "9:00", end: "19:00", days: [1] }), false);
  assert.equal(oh({ start: "10:60", end: "19:00", days: [1] }), false);
  assert.equal(oh({ start: "10:00", end: "19:00", days: [] }), false);
  assert.equal(oh({ start: "10:00", end: "19:00", days: [1, 1] }), false);
  assert.equal(oh({ start: "10:00", end: "19:00", days: [7] }), false);
  assert.equal(oh({ start: "10:00", end: "19:00", days: [1.5] }), false);
});

test("settings: approverUserIds", () => {
  assert.equal(parseSettingsBody({ ...goodSettings(), approverUserIds: [""] }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), approverUserIds: [3] }).ok, false);
  assert.equal(parseSettingsBody({ ...goodSettings(), approverUserIds: "x" }).ok, false);
});

test("isBeforeTicketCreated: earlier than creation is rejected, equal or later is fine", () => {
  const created = new Date("2026-11-20T08:00:00Z");
  assert.equal(isBeforeTicketCreated(new Date("2026-11-20T07:59:59Z"), created), true);
  assert.equal(isBeforeTicketCreated(new Date("2026-11-20T08:00:00Z"), created), false);
  assert.equal(isBeforeTicketCreated(new Date("2026-11-20T09:00:00Z"), created), false);
});

test("isBeforeTicketCreated: no creation time never rejects", () => {
  assert.equal(isBeforeTicketCreated(new Date("2000-01-01T00:00:00Z"), null), false);
});
