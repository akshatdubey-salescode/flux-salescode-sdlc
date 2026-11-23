// Run: ./node_modules/.bin/tsx --test src/lib/movement/notify-email.test.ts
// No email is sent: every test injects a fake transport (or proves the default one refuses in a test run).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmailContent, SendResult } from "@/lib/test-cases/notify";
import { buildDoneEmail, buildResetEmail, createEmailNotifier, filterRecipients, isProductionEnv, MAX_RECIPIENTS, movementUrl, type EmailNotifierDeps } from "./notify-email";
import { getMovementNotifier, setMovementNotifier, noopNotifier } from "./service/notify";

const base = { movementId: "11111111-1111-4111-8111-111111111111", deliveryId: "22222222-2222-4222-8222-222222222222", deliveryName: "Release 19 Nov", environment: "prod" as const };
const DEV = { NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "https://flux.example.com/" };
const PROD = { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://flux.example.com" };
const A = "dev+tctest@salescode.ai";
const B = "dev+tctest2@salescode.ai";
const REAL = "someone.real@salescode.ai";

function harness(over: Partial<EmailNotifierDeps> & { fail?: "result" | "throw" | "reject" } = {}) {
  const sent: Array<{ to: string[]; content: EmailContent }> = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const send: EmailNotifierDeps["send"] = async (to, content) => {
    sent.push({ to, content });
    if (over.fail === "throw") throw new Error("boom");
    if (over.fail === "reject") return Promise.reject(new Error("rejected"));
    return (over.fail === "result" ? { ok: false, error: "Email is not configured (RESEND_API_KEY missing)" } : { ok: true }) as SendResult;
  };
  const n = createEmailNotifier({ send, env: DEV, lookupDelivery: async () => ({ projectId: "pppppppp-0000-4000-8000-000000000000", responsibleEmails: [] }), log: (m) => logs.push(m), sleep: async (ms) => void sleeps.push(ms), ...over });
  return { n, sent, logs, sleeps };
}

describe("recipient safety", () => {
  it("live mail only on Vercel production, or MOVEMENT_EMAILS_LIVE=1 with a production build; everything else fails closed", () => {
    assert.equal(isProductionEnv({ VERCEL_ENV: "production" }), true);
    assert.equal(isProductionEnv({ VERCEL_ENV: "production", NODE_ENV: "production" }), true);
    assert.equal(isProductionEnv({ NODE_ENV: "production", MOVEMENT_EMAILS_LIVE: "1" }), true);
    // NODE_ENV=production alone is a local `next start` / a staging container: dev rule
    assert.equal(isProductionEnv({ NODE_ENV: "production" }), false);
    assert.equal(isProductionEnv({ NODE_ENV: "production", MOVEMENT_EMAILS_LIVE: "true" }), false);
    assert.equal(isProductionEnv({ NODE_ENV: "production", MOVEMENT_EMAILS_LIVE: "0" }), false);
    assert.equal(isProductionEnv({ NODE_ENV: "development", MOVEMENT_EMAILS_LIVE: "1" }), false);
    assert.equal(isProductionEnv({ MOVEMENT_EMAILS_LIVE: "1" }), false);
    // a Vercel preview / development deployment is never live, even with the flag
    assert.equal(isProductionEnv({ VERCEL_ENV: "preview", NODE_ENV: "production", MOVEMENT_EMAILS_LIVE: "1" }), false);
    assert.equal(isProductionEnv({ VERCEL_ENV: "development" }), false);
    assert.equal(isProductionEnv({}), false);
  });

  it("through the notifier: NODE_ENV=production without VERCEL_ENV mails only +tctest; the explicit flag or Vercel production mails everyone", async () => {
    const mk = (env: Record<string, string>) => harness({ env: { NEXT_PUBLIC_APP_URL: "https://flux.example.com", ...env } });
    const run = async (h: ReturnType<typeof harness>) => {
      await h.n.notifyReset({ ...base, hash: "h".repeat(16), signers: [A, REAL], changedAfterStart: false, counts: { added: 1, removed: 0, changed: 0 } });
      return h.sent.map((x) => x.to[0]);
    };
    assert.deepEqual(await run(mk({ NODE_ENV: "production" })), [A]);
    assert.deepEqual(await run(mk({ NODE_ENV: "production", MOVEMENT_EMAILS_LIVE: "1" })), [A, REAL]);
    assert.deepEqual(await run(mk({ VERCEL_ENV: "production" })), [A, REAL]);
    assert.deepEqual(await run(mk({ VERCEL_ENV: "preview", MOVEMENT_EMAILS_LIVE: "1", NODE_ENV: "production" })), [A]);
  });

  it("outside production only +tctest / +tctest2 @salescode.ai get mail; lookalikes, invalid and duplicates are dropped", () => {
    const f = filterRecipients([A, B.toUpperCase(), REAL, "x+tctest@salescode.ai.evil.com", "evil@x.com,dev+tctest@salescode.ai", "a+tctest3@salescode.ai", "tctest@salescode.ai", "not-an-email", "", A.toUpperCase()], false);
    assert.deepEqual(f.allowed, [A, B]);
    assert.equal(f.devDropped, 4); // REAL, the .evil.com lookalike, +tctest3, no-plus tctest
    assert.equal(f.invalid, 2); // the comma address and not-an-email
  });

  it("in production every valid address is mailed, de-duplicated and capped", () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 5 }, (_, i) => `p${i}@salescode.ai`);
    const f = filterRecipients([REAL, REAL.toUpperCase(), ...many], true);
    assert.equal(f.allowed.length, MAX_RECIPIENTS);
    assert.equal(f.capped, 6);
    assert.equal(f.allowed[0], REAL);
  });
});

describe("the four notifications", () => {
  it("signer assigned: one mail to that person, subject, role, link with project, delivery and movement", async () => {
    const h = harness();
    await h.n.notifySignerAssigned({ ...base, slot: "ba", email: A, assignedBy: "Asha" });
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].to, [A]);
    assert.equal(h.sent[0].content.subject, "Movement to PROD: Release 19 Nov: your sign-off is needed");
    assert.match(h.sent[0].content.html, /named you<\/p>|Asha named you/);
    assert.ok(h.sent[0].content.html.includes("<strong>BA</strong>"));
    const url = `https://flux.example.com/projects/pppppppp-0000-4000-8000-000000000000/deliveries/${base.deliveryId}/movements/${base.movementId}`;
    assert.ok(h.sent[0].content.html.includes(url), "html link is the escaped movement URL");
    assert.ok(h.sent[0].content.text.includes(`/projects/pppppppp-0000-4000-8000-000000000000/deliveries/${base.deliveryId}/movements/${base.movementId}`), "the link is the movement's own page");
    assert.ok(!h.sent[0].content.text.includes("tab=delivery-tracker"), "no old tab / panel deep link");
  });

  it("reset: every signer, the capped counts and the short hash; after-start wording differs", async () => {
    const h = harness();
    await h.n.notifyReset({ ...base, hash: "abcdef0123456789", signers: [A, B, A, REAL], changedAfterStart: false, counts: { added: 3, removed: 1, changed: 5000 } });
    assert.deepEqual(h.sent.map((s) => s.to[0]), [A, B]); // dev: the real colleague is dropped, duplicates collapsed
    assert.equal(h.sent[0].content.subject, "Movement to PROD: Release 19 Nov: your sign-off is needed");
    assert.ok(h.sent[0].content.text.includes("3 added, 1 removed, 999+ changed"));
    assert.ok(h.sent[0].content.text.includes("abcdef01"));
    assert.ok(!h.sent[0].content.text.includes("abcdef0123"));
    assert.ok(h.logs.some((l) => /dropped 1/.test(l)));
    const after = buildResetEmail({ ...base, hash: "ff00ff00aa", changedAfterStart: true, counts: { added: 0, removed: 0, changed: 1 } }, "https://x/y");
    assert.match(after.subject, /the checklist changed during the deployment/);
    assert.match(after.text, /Nothing was reset/);
  });

  it("ready to deploy goes to the deployer only", async () => {
    const h = harness();
    await h.n.notifyReadyToDeploy({ ...base, deployerEmail: B, hash: "1234567890" });
    assert.deepEqual(h.sent.map((s) => s.to), [[B]]);
    assert.equal(h.sent[0].content.subject, "Movement to PROD: Release 19 Nov: all signed, ready to deploy");
  });

  it("done goes to the three signers plus the delivery's responsible people, once each", async () => {
    const h = harness({ env: PROD, lookupDelivery: async () => ({ projectId: null, responsibleEmails: ["R1@salescode.ai", "dep@salescode.ai"] }) });
    await h.n.notifyDone({ ...base, recipients: ["dep@salescode.ai", "ba@salescode.ai", "lead@salescode.ai"], moved: 4, held: 1 });
    assert.deepEqual(h.sent.map((s) => s.to[0]), ["dep@salescode.ai", "ba@salescode.ai", "lead@salescode.ai", "r1@salescode.ai"]);
    assert.equal(h.sent[0].content.subject, "Movement to PROD: Release 19 Nov: done");
    assert.ok(h.sent[0].content.text.includes("4 Jiras moved, 1 held back."));
    assert.ok(h.sent[0].content.text.includes("Open: https://flux.example.com/"), "no project known: the home page");
    assert.ok(!h.sent[0].content.text.includes("/projects"));
  });

  it("in a dev environment the same done mail goes only to +tctest addresses", async () => {
    const h = harness({ lookupDelivery: async () => ({ projectId: null, responsibleEmails: [REAL, B] }) });
    await h.n.notifyDone({ ...base, recipients: [A, REAL], moved: 1, held: 0 });
    assert.deepEqual(h.sent.map((s) => s.to[0]), [A, B]);
  });
});

describe("escaping and logging", () => {
  const evil = `</strong><script>alert(1)</script><img src=x onerror=1> "q" & \r\nBcc: attacker@evil.com`;
  it("escapes the delivery name and the assigner in HTML, keeps the subject on one line", async () => {
    const h = harness();
    await h.n.notifySignerAssigned({ ...base, deliveryName: evil, slot: "lead", email: A, assignedBy: evil });
    const { subject, html } = h.sent[0].content;
    assert.ok(!/[\r\n]/.test(subject));
    assert.ok(!html.includes("<script>") && !html.includes("<img"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=1&gt;"));
    const done = buildDoneEmail({ ...base, deliveryName: evil, moved: 1, held: 0 }, `https://x/?a="b"&c=<d>`);
    assert.ok(!done.html.includes("<script>") && !done.html.includes('"b"'));
  });

  it("movementUrl encodes the ids and returns '' without an app URL", () => {
    assert.equal(movementUrl("", base, null), "");
    assert.equal(movementUrl("https://f.io///", { deliveryId: "a b", movementId: "c&d" }, "p/q"), "https://f.io/projects/p%2Fq/deliveries/a%20b/movements/c%26d");
    assert.equal(movementUrl("https://f.io", { deliveryId: "d1", movementId: "m1" }, null), "https://f.io/", "no project known: the home page");
  });

  it("never throws: a failing, throwing or rejecting transport, a failing lookup, a missing app URL", async () => {
    for (const fail of ["result", "throw", "reject"] as const) {
      const h = harness({ fail });
      await assert.doesNotReject(async () => {
        await h.n.notifyReset({ ...base, hash: "h".repeat(16), signers: [A, B], changedAfterStart: false, counts: { added: 1, removed: 0, changed: 0 } });
      });
      // "not configured" is not retried; a thrown / rejected transport is a network error and is retried once
      assert.equal(h.sent.length, fail === "result" ? 2 : 4, `${fail}: each recipient was tried, a failure does not stop the others`);
      assert.ok(h.logs.some((l) => /2 of 2 not sent/.test(l)));
    }
    const h = harness({ lookupDelivery: async () => { throw new Error("db down"); } });
    await assert.doesNotReject(async () => {
      await h.n.notifyReadyToDeploy({ ...base, deployerEmail: A, hash: "x" });
    });
    assert.equal(h.sent.length, 1, "the mail still goes out, with the generic link");
    const noUrl = harness({ env: { NODE_ENV: "development" } });
    await assert.doesNotReject(async () => {
      await noUrl.n.notifyDone({ ...base, recipients: [A], moved: 1, held: 0 });
    });
    assert.equal(noUrl.sent.length, 0);
    assert.ok(noUrl.logs.some((l) => /NEXT_PUBLIC_APP_URL/.test(l)));
  });

  it("logs hold counts and reasons only, never an address", async () => {
    const h = harness({ fail: "result" });
    await h.n.notifyReset({ ...base, hash: "h".repeat(16), signers: [A, REAL, "bad address"], changedAfterStart: false, counts: { added: 1, removed: 0, changed: 0 } });
    assert.ok(h.logs.length >= 2);
    for (const l of h.logs) assert.ok(!/@/.test(l), l);
  });

  it("the DEFAULT transport sends nothing in a test run (and the registry default is the email notifier)", async () => {
    assert.ok(process.env.NODE_TEST_CONTEXT, "this suite runs under node --test");
    const logs: string[] = [];
    const n = createEmailNotifier({ env: PROD, lookupDelivery: async () => null, log: (m) => logs.push(m) });
    await n.notifyReadyToDeploy({ ...base, deployerEmail: REAL, hash: "x" });
    assert.ok(logs.some((l) => /1 of 1 not sent .*test run/.test(l)), logs.join("|"));
    // the registry: default is the real notifier, a spy replaces it, null restores the default (not the no-op)
    const dflt = getMovementNotifier();
    assert.notEqual(dflt, noopNotifier);
    setMovementNotifier(noopNotifier);
    assert.equal(getMovementNotifier(), noopNotifier);
    setMovementNotifier(null);
    assert.equal(getMovementNotifier(), dflt);
  });
});

describe("pacing, retry, empty diff, odd names", () => {
  /** A transport that answers from a script, one answer per call. */
  const scripted = (answers: SendResult[]) => {
    const calls: string[] = [];
    const send: EmailNotifierDeps["send"] = async (to) => {
      calls.push(to[0]);
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    };
    return { send, calls };
  };
  const reset = (n: ReturnType<typeof createEmailNotifier>, signers: string[]) =>
    n.notifyReset({ ...base, hash: "h".repeat(16), signers, changedAfterStart: false, counts: { added: 1, removed: 0, changed: 0 } });

  it("pauses ~600 ms between two sends (not before the first) so Resend's rate limit is not hit", async () => {
    const { send, calls } = scripted([{ ok: true }]);
    const h = harness({ send });
    await reset(h.n, [A, B, "c+tctest@salescode.ai"]);
    assert.equal(calls.length, 3);
    assert.deepEqual(h.sleeps, [600, 600]);
  });

  it("a 429 is retried once after a pause and then succeeds: no failure logged", async () => {
    const { send, calls } = scripted([{ ok: false, error: "429 Too many requests, rate limit exceeded" }, { ok: true }]);
    const h = harness({ send });
    await reset(h.n, [A]);
    assert.equal(calls.length, 2);
    assert.deepEqual(h.sleeps, [1500]);
    assert.equal(h.logs.length, 0);
  });

  it("a 5xx twice is logged with counts, stops after one retry, and says it is not retried later", async () => {
    const { send, calls } = scripted([{ ok: false, error: "503 Service unavailable" }]);
    const h = harness({ send });
    await reset(h.n, [A, B]);
    assert.equal(calls.length, 4, "two recipients, one retry each, no more");
    assert.deepEqual(h.logs, ["[movement] checklist reset: 2 of 2 not sent (not retried later)"]);
  });

  it("a bad address answer is NOT retried", async () => {
    const { send, calls } = scripted([{ ok: false, error: "Invalid `to` field" }]);
    const h = harness({ send });
    await reset(h.n, [A]);
    assert.equal(calls.length, 1);
    assert.deepEqual(h.sleeps, []);
    assert.equal(h.logs.length, 1);
  });

  it("a reset with no counted change has no 'Changes:' line (text and HTML); with counts it has", () => {
    const zero = buildResetEmail({ ...base, hash: "abcdef0123", changedAfterStart: false, counts: { added: 0, removed: 0, changed: 0 } }, "https://x/y");
    assert.ok(!zero.text.includes("Changes:") && !zero.html.includes("Changes:") && !zero.text.includes("0 added"));
    assert.ok(zero.text.includes("New checklist abcdef01"));
    const some = buildResetEmail({ ...base, hash: "abcdef0123", changedAfterStart: false, counts: { added: 0, removed: 0, changed: 2 } }, "https://x/y");
    assert.ok(some.text.includes("Changes: 0 added, 0 removed, 2 changed"));
  });

  it("the text part and subject survive CRLF and non-ASCII in the delivery name: one line, nothing dropped", () => {
    const name = "Réléase\r\n日本語 ✓\tBcc: x@evil.com";
    const e = buildDoneEmail({ ...base, deliveryName: name, moved: 2, held: 0 }, "https://x/y");
    assert.ok(!/[\r\n]/.test(e.subject));
    assert.ok(e.subject.includes("Réléase 日本語 ✓"));
    const firstLine = e.text.split("\n")[0];
    assert.ok(firstLine.includes("Réléase 日本語 ✓") && !/\r/.test(firstLine));
    assert.ok(e.html.includes("Réléase") && e.html.includes("日本語 ✓"), "the HTML keeps the name");
  });
});
