import { MAX_MESSAGE, MAX_RECIPIENTS, MAX_SUBJECT } from "@/lib/sprints/send-progress-email";
import { isValidDateString } from "@/lib/validation";
import { istToday } from "./recurrence";
import { isScheduleFrequency, validateCadence, type CadenceSpec } from "./types";

/**
 * The one body parser every schedule write route uses, so creating and editing
 * a schedule can't drift apart — and so the limits a scheduled send obeys are
 * literally the limits the manual send obeys (same constants, imported from
 * the sender).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Just the recipient list, for the "add more people" edit. Same normalisation
 * (lowercased, de-duplicated) and same cap as a full write, so a schedule
 * edited this way is indistinguishable from one created with the list.
 */
export function parseRecipients(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  const recipients = Array.isArray(value)
    ? [...new Set(value.map((r) => String(r).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (recipients.length === 0) {
    return { ok: false, error: "recipients must be a non-empty array of emails" };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return { ok: false, error: `At most ${MAX_RECIPIENTS} recipients per send` };
  }
  const bad = recipients.find((r) => !EMAIL_RE.test(r));
  if (bad) return { ok: false, error: `Invalid email address: ${bad}` };
  return { ok: true, value: recipients };
}

export type ParsedSchedule = {
  recipients: string[];
  subject: string;
  message: string;
  cadence: CadenceSpec;
  endsOn: string | null;
};

export type ParseResult = { ok: true; value: ParsedSchedule } | { ok: false; error: string };

export function parseScheduleBody(body: {
  recipients?: unknown;
  subject?: unknown;
  message?: unknown;
  frequency?: unknown;
  dayOfWeek?: unknown;
  dayOfMonth?: unknown;
  endsOn?: unknown;
}): ParseResult {
  const recipients = Array.isArray(body.recipients)
    ? [...new Set(body.recipients.map((r) => String(r).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (recipients.length === 0) {
    return { ok: false, error: "recipients must be a non-empty array of emails" };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return { ok: false, error: `At most ${MAX_RECIPIENTS} recipients per send` };
  }
  const bad = recipients.find((r) => !EMAIL_RE.test(r));
  if (bad) return { ok: false, error: `Invalid email address: ${bad}` };

  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, MAX_SUBJECT) : "";
  if (!subject) return { ok: false, error: "subject must be a non-empty string" };

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) return { ok: false, error: "message must be a non-empty string" };

  if (!isScheduleFrequency(body.frequency)) {
    return { ok: false, error: "frequency must be daily, weekly or monthly" };
  }
  const cadence: CadenceSpec = {
    frequency: body.frequency,
    dayOfWeek: typeof body.dayOfWeek === "number" ? body.dayOfWeek : null,
    dayOfMonth: typeof body.dayOfMonth === "number" ? body.dayOfMonth : null,
  };
  const cadenceError = validateCadence(cadence);
  if (cadenceError) return { ok: false, error: cadenceError };

  let endsOn: string | null = null;
  if (body.endsOn !== undefined && body.endsOn !== null && body.endsOn !== "") {
    if (!isValidDateString(body.endsOn)) {
      return { ok: false, error: "endsOn must be a YYYY-MM-DD date" };
    }
    // An end date already in the past would create a schedule that stops on
    // its first evaluation — reject it where the user can still see why.
    if (body.endsOn <= istToday()) {
      return { ok: false, error: "endsOn must be in the future" };
    }
    endsOn = body.endsOn;
  }

  return { ok: true, value: { recipients, subject, message, cadence, endsOn } };
}
