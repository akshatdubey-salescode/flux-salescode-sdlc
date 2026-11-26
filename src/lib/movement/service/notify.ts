/**
 * Notification hooks of the movement service: the interface, the no-op notifier and the registry.
 * The default is the Resend implementation (../notify-email.ts: dev-safe, never throws, sends
 * nothing in a test run); `setMovementNotifier` replaces it (tests inject a recording spy, null
 * restores the default). The service calls these AFTER its transaction committed, through
 * `notifySafely`, so a mail problem can never fail or roll back a sign-off, a refresh or a status
 * change.
 */
import { emailNotifier } from "../notify-email";
import type { MovementEnvironment, MovementSlot } from "../values";

export interface NotifyBase {
  movementId: string;
  deliveryId: string;
  deliveryName: string;
  environment: MovementEnvironment;
}

export interface MovementNotifier {
  /** A person was named in a slot (on create, or when the slot changed). */
  notifySignerAssigned(p: NotifyBase & { slot: MovementSlot; email: string; assignedBy: string }): Promise<void> | void;
  /**
   * The checklist changed. `changedAfterStart` = the deployment is already in progress (nothing was
   * reset); otherwise every sign-off was cleared and `signers` lists everyone who must look again.
   */
  notifyReset(
    p: NotifyBase & { hash: string; signers: string[]; changedAfterStart: boolean; counts: { added: number; removed: number; changed: number } }
  ): Promise<void> | void;
  /** Every slot signed: tell the deployer. */
  notifyReadyToDeploy(p: NotifyBase & { deployerEmail: string; hash: string }): Promise<void> | void;
  /** The deployment was marked done. */
  notifyDone(p: NotifyBase & { recipients: string[]; moved: number; held: number }): Promise<void> | void;
}

export const noopNotifier: MovementNotifier = {
  notifySignerAssigned() {},
  notifyReset() {},
  notifyReadyToDeploy() {},
  notifyDone() {},
};

let current: MovementNotifier = emailNotifier;

/** Replace the notifier (`noopNotifier` silences it); null restores the default email notifier. */
export function setMovementNotifier(n: MovementNotifier | null): void {
  current = n ?? emailNotifier;
}

export function getMovementNotifier(): MovementNotifier {
  return current;
}

/** Run a notification; a failure is logged without its payload (it holds email addresses) and swallowed. */
export async function notifySafely(fn: (n: MovementNotifier) => Promise<void> | void): Promise<void> {
  try {
    await fn(current);
  } catch (e) {
    console.warn("[movement] notification failed:", e instanceof Error ? e.message.slice(0, 120) : "error");
  }
}
