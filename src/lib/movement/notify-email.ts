/**
 * The real movement notifier: Resend emails for "your sign-off is needed", "the checklist changed",
 * "all signed, ready to deploy" and "done". Same pattern as test-cases/notify.ts (same Resend
 * settings, same layout helper, pure builders that escape everything user-supplied, sending never
 * throws), plus two safety rules of its own:
 *  - live mail goes out ONLY when `VERCEL_ENV === "production"`, or when `MOVEMENT_EMAILS_LIVE=1` is set
 *    together with `NODE_ENV=production` (a self-hosted production: Docker / Jenkins). Everything else
 *    (local `next start`, a staging container, tsx against the dev database, a preview) fails closed to the
 *    test rule: only `+tctest@salescode.ai` / `+tctest2@salescode.ai` addresses are mailed, the rest is
 *    dropped and only the COUNT is logged (no addresses in logs);
 *  - a test run (node --test) never sends, whatever the transport; tests inject a fake one.
 * The service calls these after its transaction committed, through notifySafely.
 */
import { escapeHtml as esc, sendEmail, shell, type EmailContent, type SendResult } from "@/lib/test-cases/notify";
import { isValidEmail, normEmail } from "./service/state";
import type { MovementNotifier, NotifyBase } from "./service/notify";
import type { MovementSlot } from "./values";

export type EmailTransport = (to: string[], content: EmailContent) => Promise<SendResult>;

export interface DeliveryInfo {
  projectId: string | null;
  responsibleEmails: string[];
}

export interface EmailNotifierDeps {
  /** Default: the Resend helper of the test-case emails. */
  send?: EmailTransport;
  /** Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Default: one query on `deliveries` (project for the link, responsible people for "done"). */
  lookupDelivery?: (deliveryId: string) => Promise<DeliveryInfo | null>;
  /** Default: console.warn. Never receives an address. */
  log?: (message: string) => void;
  /** Pause between two sends (Resend allows 2 requests a second); default 600 ms. */
  pauseMs?: number;
  /** Wait before the single retry of a rate-limited / 5xx send; default 1500 ms. */
  retryDelayMs?: number;
  /** Default: setTimeout. Tests pass a recorder. */
  sleep?: (ms: number) => Promise<void>;
}

/** Most recipients one notification mails (a movement has 3 signers plus the delivery's responsible people). */
export const MAX_RECIPIENTS = 20;
/** Largest count shown in a "changed" email; the movement page has the details. */
export const MAX_SHOWN_COUNT = 999;

/** A transient failure worth one retry: rate limit, 5xx, timeout, network. Not a bad address or a missing key. */
const RETRYABLE = /rate.?limit|too many|429|\b5\d\d\b|timeout|timed out|temporar|unavailable|network|fetch failed|ECONN|ETIMEDOUT/i;

const DEV_ALLOWED = /^[^@\s,;<>]+\+tctest2?@salescode\.ai$/;

/**
 * Live mail = Vercel production, or an explicit opt-in on a production build (`MOVEMENT_EMAILS_LIVE=1`).
 * Fails closed: NODE_ENV=production alone (a local `next start`, a staging container) is NOT enough,
 * because a staging copy with production data would mail real people.
 */
export function isProductionEnv(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV !== undefined) return env.VERCEL_ENV === "production";
  return env.MOVEMENT_EMAILS_LIVE === "1" && env.NODE_ENV === "production";
}

export interface RecipientFilter {
  allowed: string[];
  invalid: number;
  /** Dropped by the non-production rule. */
  devDropped: number;
  /** Beyond MAX_RECIPIENTS. */
  capped: number;
}

/** Normalise, de-duplicate, drop invalid addresses, apply the non-production rule, cap. */
export function filterRecipients(emails: readonly string[], production: boolean): RecipientFilter {
  const seen = new Set<string>();
  let invalid = 0;
  let devDropped = 0;
  const ok: string[] = [];
  for (const raw of emails) {
    if (typeof raw !== "string") {
      invalid++;
      continue;
    }
    const e = normEmail(raw);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    if (!isValidEmail(e)) invalid++;
    else if (!production && !DEV_ALLOWED.test(e)) devDropped++;
    else ok.push(e);
  }
  return { allowed: ok.slice(0, MAX_RECIPIENTS), invalid, devDropped, capped: Math.max(0, ok.length - MAX_RECIPIENTS) };
}

// --- builders (pure) -----------------------------------------------------------------------------

const SLOT_LABEL: Record<MovementSlot, string> = { deployer: "deployer", ba: "BA", lead: "lead" };

/** Single line, no control characters (a subject is a header), bounded. */
const oneLine = (s: string, n = 120): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

const subjectBase = (p: NotifyBase) => `Movement to ${p.environment.toUpperCase()}: ${oneLine(p.deliveryName) || "delivery"}`;
const shown = (n: number) => (n > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : String(Math.max(0, Math.trunc(n) || 0)));

/**
 * Where the e-mail's button goes: the movement's own page, `/projects/<project>/deliveries/<delivery>/movements/<movement>`. Without a known
 * project there is no page address to build, so it falls back to the app's home page (nothing is logged).
 */
export function movementUrl(appUrl: string, p: Pick<NotifyBase, "deliveryId" | "movementId">, projectId: string | null): string {
  const base = appUrl.replace(/\/+$/, "");
  if (!base) return "";
  if (projectId) return `${base}/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(p.deliveryId)}/movements/${encodeURIComponent(p.movementId)}`;
  return `${base}/`;
}

const intro = (p: NotifyBase) => `<p><strong>${esc(p.deliveryName)}</strong> &mdash; movement to <strong>${esc(p.environment.toUpperCase())}</strong></p>`;
const textHead = (p: NotifyBase) => `${oneLine(p.deliveryName, 200)}: movement to ${p.environment.toUpperCase()}`;

export function buildSignerAssignedEmail(p: NotifyBase & { slot: MovementSlot; assignedBy: string }, url: string): EmailContent {
  const role = SLOT_LABEL[p.slot];
  const by = p.assignedBy.trim();
  return {
    subject: `${subjectBase(p)}: your sign-off is needed`,
    html: shell(
      "Your sign-off is needed",
      `${intro(p)}<p>${by ? `${esc(by)} named you` : "You were named"} as the <strong>${esc(role)}</strong> for this movement. Once the checklist is ready, please read it and sign off.</p>`,
      url,
      "Open the movement"
    ),
    text: `${textHead(p)}\n\n${by ? `${by} named you` : "You were named"} as the ${role} for this movement. Once the checklist is ready, please read it and sign off.\n\nOpen: ${url}`,
  };
}

export function buildResetEmail(p: NotifyBase & { hash: string; changedAfterStart: boolean; counts: { added: number; removed: number; changed: number } }, url: string): EmailContent {
  const c = p.counts;
  const none = !c.added && !c.removed && !c.changed;
  const diff = none ? "" : `${shown(c.added)} added, ${shown(c.removed)} removed, ${shown(c.changed)} changed`;
  const h = p.hash.slice(0, 8);
  const subject = p.changedAfterStart ? `${subjectBase(p)}: the checklist changed during the deployment` : `${subjectBase(p)}: your sign-off is needed`;
  const what = p.changedAfterStart
    ? "The checklist changed after the deployment started. Nothing was reset, but please look at what changed."
    : "The checklist changed, so every sign-off was cleared. Please read it again and sign off.";
  return {
    subject,
    html: shell(
      p.changedAfterStart ? "The checklist changed during the deployment" : "Please sign off again",
      `${intro(p)}<p>${esc(what)}</p><p style="margin:12px 0;padding:8px 12px;background:#f3f4f6;border-radius:6px">${diff ? `Changes: ${esc(diff)}<br>` : ""}<span style="color:#6b7280">New checklist ${esc(h)}. The movement page lists what changed.</span></p>`,
      url,
      "See what changed"
    ),
    text: `${textHead(p)}\n\n${what}\n${diff ? `Changes: ${diff}\n` : ""}New checklist ${h}.\n\nOpen: ${url}`,
  };
}

export function buildReadyToDeployEmail(p: NotifyBase & { hash: string }, url: string): EmailContent {
  return {
    subject: `${subjectBase(p)}: all signed, ready to deploy`,
    html: shell(
      "Ready to deploy",
      `${intro(p)}<p>All three sign-offs are in for checklist ${esc(p.hash.slice(0, 8))}. You can start the deployment.</p>`,
      url,
      "Open the movement"
    ),
    text: `${textHead(p)}\n\nAll three sign-offs are in for checklist ${p.hash.slice(0, 8)}. You can start the deployment.\n\nOpen: ${url}`,
  };
}

export function buildDoneEmail(p: NotifyBase & { moved: number; held: number }, url: string): EmailContent {
  const line = `${shown(p.moved)} Jira${p.moved === 1 ? "" : "s"} moved, ${shown(p.held)} held back.`;
  return {
    subject: `${subjectBase(p)}: done`,
    html: shell("The movement is done", `${intro(p)}<p>${esc(line)}</p><p>Open the movement to confirm the delivered / not delivered status of each Jira.</p>`, url, "Open the movement"),
    text: `${textHead(p)}\n\nThe movement is done. ${line}\nOpen the movement to confirm the delivered / not delivered status of each Jira.\n\nOpen: ${url}`,
  };
}

// --- the notifier --------------------------------------------------------------------------------

async function defaultLookup(deliveryId: string): Promise<DeliveryInfo | null> {
  // Loaded on first use so importing this module (tests, the notify.ts registration) opens no connection.
  const [{ db }, { deliveries }, { eq }] = await Promise.all([import("@/lib/db"), import("@/lib/db/schema"), import("drizzle-orm")]);
  const [row] = await db.select({ projectId: deliveries.projectId, responsibleEmails: deliveries.responsibleEmails }).from(deliveries).where(eq(deliveries.id, deliveryId));
  return row ? { projectId: row.projectId, responsibleEmails: row.responsibleEmails ?? [] } : null;
}

export function createEmailNotifier(deps: EmailNotifierDeps = {}): MovementNotifier {
  const env = () => deps.env ?? process.env;
  const log = deps.log ?? ((m: string) => console.warn(m));
  const lookup = deps.lookupDelivery ?? defaultLookup;
  // Only a REAL send is blocked in a test run; an injected transport is the test's own fake.
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pauseMs = deps.pauseMs ?? 600;
  const retryDelayMs = deps.retryDelayMs ?? 1500;
  const transport: EmailTransport = deps.send ?? ((to, c) => (process.env.NODE_TEST_CONTEXT ? Promise.resolve({ ok: false, error: "test run" } as SendResult) : sendEmail(to, c)));

  async function info(deliveryId: string): Promise<DeliveryInfo | null> {
    try {
      return await lookup(deliveryId);
    } catch {
      // The mail still goes out (generic link, no responsible people); say so, without ids or addresses.
      log("[movement] recipient lookup failed: sending with the generic link and without the delivery's responsible people");
      return null;
    }
  }

  /** Filter the recipients, mail each one, log counts only. Never throws. */
  async function deliver(kind: string, to: readonly string[], build: (url: string) => EmailContent, ids: Pick<NotifyBase, "deliveryId" | "movementId">, projectId: string | null): Promise<void> {
    try {
      const e = env();
      const f = filterRecipients(to, isProductionEnv(e));
      if (f.devDropped || f.invalid || f.capped) {
        log(`[movement] ${kind}: ${f.allowed.length} to send, dropped ${f.devDropped} (non-production: only +tctest addresses), ${f.invalid} invalid, ${f.capped} over the cap`);
      }
      if (f.allowed.length === 0) return;
      const url = movementUrl(e.NEXT_PUBLIC_APP_URL ?? "", ids, projectId);
      if (!url) {
        log(`[movement] ${kind}: not sent, NEXT_PUBLIC_APP_URL is not set`);
        return;
      }
      const content = build(url);
      // One request per recipient (the sender wrapper has no batch call): paced, and a rate-limited or 5xx
      // answer is retried once. A mail that still fails is only LOGGED (counts): it is never retried later,
      // because the service stores last_notified_hash before sending, so the same change never mails twice.
      let failed = 0;
      let missingConfig = false;
      for (let i = 0; i < f.allowed.length; i++) {
        if (i > 0) await sleep(pauseMs);
        const attempt = () => transport([f.allowed[i]], content).catch((): SendResult => ({ ok: false, error: "network error: the transport threw" }));
        let r = await attempt();
        if (!r.ok && RETRYABLE.test(r.error)) {
          await sleep(retryDelayMs);
          r = await attempt();
        }
        if (!r.ok) {
          failed++;
          if (/not configured|test run/i.test(r.error)) missingConfig = true;
        }
      }
      if (failed) log(`[movement] ${kind}: ${failed} of ${f.allowed.length} not sent${missingConfig ? " (email is not configured, or this is a test run)" : " (not retried later)"}`);
    } catch (err) {
      log(`[movement] ${kind}: notification failed (${err instanceof Error ? err.constructor.name : "error"})`);
    }
  }

  return {
    async notifySignerAssigned(p) {
      const d = await info(p.deliveryId);
      await deliver("signer assigned", [p.email], (url) => buildSignerAssignedEmail(p, url), p, d?.projectId ?? null);
    },
    async notifyReset(p) {
      const d = await info(p.deliveryId);
      await deliver(p.changedAfterStart ? "changed after start" : "checklist reset", p.signers, (url) => buildResetEmail(p, url), p, d?.projectId ?? null);
    },
    async notifyReadyToDeploy(p) {
      const d = await info(p.deliveryId);
      await deliver("ready to deploy", [p.deployerEmail], (url) => buildReadyToDeployEmail(p, url), p, d?.projectId ?? null);
    },
    async notifyDone(p) {
      const d = await info(p.deliveryId);
      // the three signers (given) plus the delivery's responsible people
      await deliver("done", [...p.recipients, ...(d?.responsibleEmails ?? [])], (url) => buildDoneEmail(p, url), p, d?.projectId ?? null);
    },
  };
}

export const emailNotifier: MovementNotifier = createEmailNotifier();
