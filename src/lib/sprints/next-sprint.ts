import { isValidDateString } from "@/lib/validation";

// ---------------------------------------------------------------------------
// "Create the next sprint" — the defaults offered wherever a flow needs a
// destination sprint that doesn't exist yet (moving one item out of an active
// sprint, or carrying a whole sprint's spillover at close time).
//
// The point of deriving every field is to stop those flows minting junk
// sprints. Both are entered while thinking about something else — a slipping
// ticket, a sprint you're trying to close — so a blank form invites a
// mis-dated, badly named sprint that the whole team then sees. Deriving the
// name and dates from the sprint you're standing in turns the common case
// into a confirmation instead of a composition.
//
// Pure and free of server imports so both the API routes and the client
// dialogs use exactly the same rules.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Parsed as UTC — these are plain `date` columns, never wall-clock instants. */
function parseDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function toDayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  return toDayStr(new Date(parseDay(dateStr).getTime() + days * DAY_MS));
}

/** Inclusive length in days — a Mon→Fri sprint is 5, not 4. */
export function sprintLengthDays(startDate: string, endDate: string): number {
  return Math.round((parseDay(endDate).getTime() - parseDay(startDate).getTime()) / DAY_MS) + 1;
}

/**
 * "Demo 2" → "Demo 3". Increments the LAST run of digits in the name, keeping
 * any zero-padding ("Sprint 09" → "Sprint 10") and whatever follows it
 * ("S2 - Wholesaler" → "S3 - Wholesaler").
 *
 * Returns "" when the name carries no number at all: there's no sensible
 * successor to "Hardening Sprint", and a silent "Hardening Sprint 2" would be
 * a guess the user didn't make. Callers surface the empty name as a required
 * field instead.
 */
export function incrementSprintName(name: string): string {
  const match = /^(.*?)(\d+)(\D*)$/.exec(name);
  if (!match) return "";
  const [, head, digits, tail] = match;
  const next = String(Number(digits) + 1);
  // Keep the original width only if it was zero-padded, and only while the
  // successor still fits it (Sprint 09 → 10, but Sprint 99 → 100).
  const padded = digits.startsWith("0") && next.length < digits.length ? next.padStart(digits.length, "0") : next;
  return `${head}${padded}${tail}`;
}

export type NewSprintSpec = { name: string; startDate: string; endDate: string };

/**
 * The next sprint in the same cadence: starts the day after this one ends and
 * runs for the same number of days, so a team on two-week iterations keeps
 * them without touching the date fields.
 */
export function deriveNextSprint(sprint: { name: string; startDate: string; endDate: string }): NewSprintSpec {
  const startDate = addDays(sprint.endDate, 1);
  return {
    name: incrementSprintName(sprint.name),
    startDate,
    endDate: addDays(startDate, sprintLengthDays(sprint.startDate, sprint.endDate) - 1),
  };
}

/** True once a derived/edited spec is complete enough to submit — the client's button gate. */
export function isNewSprintSpecReady(spec: NewSprintSpec): boolean {
  return parseNewSprintSpec(spec).ok;
}

export type ParsedNewSprint = { ok: true; spec: NewSprintSpec } | { ok: false; error: string };

/**
 * Server-side validation of an inbound `newSprint` body, mirroring the create
 * route's own rules so an inline creation can't slip past them. Tagged on `ok`
 * rather than a nullable error so callers narrow with a plain early return.
 */
export function parseNewSprintSpec(input: unknown): ParsedNewSprint {
  const fail = (error: string) => ({ ok: false, error } as const);
  if (typeof input !== "object" || input === null) {
    return fail("newSprint must be an object");
  }
  const { name, startDate, endDate } = input as Record<string, unknown>;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return fail("newSprint.name is required");
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return fail("newSprint.startDate and newSprint.endDate must be valid YYYY-MM-DD dates");
  }
  if (endDate < startDate) return fail("newSprint.endDate must not be before newSprint.startDate");
  return { ok: true, spec: { name: trimmed, startDate, endDate } };
}
