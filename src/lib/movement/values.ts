/** Values persisted by the delivery_movements pg enums. Kept free of imports so schema.ts can use them. */
export const MOVEMENT_ENVIRONMENT_VALUES = ["demo", "uat", "prod"] as const;
export type MovementEnvironment = (typeof MOVEMENT_ENVIRONMENT_VALUES)[number];

export const MOVEMENT_STATUS_VALUES = [
  "draft",
  "ready",
  "signed_off",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type MovementStatus = (typeof MOVEMENT_STATUS_VALUES)[number];

/** The three sign-off slots: the person who deploys, the BA, and the lead. */
export const MOVEMENT_SLOT_VALUES = ["deployer", "ba", "lead"] as const;
export type MovementSlot = (typeof MOVEMENT_SLOT_VALUES)[number];

export const MOVEMENT_READINESS_VALUES = ["ready", "blocked", "override"] as const;
export type MovementReadiness = (typeof MOVEMENT_READINESS_VALUES)[number];

export const MOVEMENT_RESULT_VALUES = ["pending", "moved", "held"] as const;
export type MovementResult = (typeof MOVEMENT_RESULT_VALUES)[number];

/** Why a snapshot was taken; snapshots exist only at these three moments. */
export const MOVEMENT_SNAPSHOT_REASON_VALUES = ["signoff", "start", "done"] as const;
export type MovementSnapshotReason = (typeof MOVEMENT_SNAPSHOT_REASON_VALUES)[number];

function guard<T extends string>(values: readonly T[]) {
  const set = new Set<string>(values);
  return (value: unknown): value is T => typeof value === "string" && set.has(value);
}

/** Type guards used by every movement route to reject an unknown value from a request body. */
export const isMovementEnvironment = guard(MOVEMENT_ENVIRONMENT_VALUES);
export const isMovementStatus = guard(MOVEMENT_STATUS_VALUES);
export const isMovementSlot = guard(MOVEMENT_SLOT_VALUES);
export const isMovementReadiness = guard(MOVEMENT_READINESS_VALUES);
export const isMovementResult = guard(MOVEMENT_RESULT_VALUES);
export const isMovementSnapshotReason = guard(MOVEMENT_SNAPSHOT_REASON_VALUES);

// Size caps. The DB enforces them with CHECK constraints (schema.ts) and the
// service code truncates to the same numbers before writing, so a violation
// is a bug, never a user-facing error.
export const MAX_WARNINGS_PER_ITEM = 20;
export const MAX_WARNING_MESSAGE_CHARS = 199; // each warning is {code, message < 200 chars}
export const MAX_RECORD_REFS_PER_ITEM = 50;
export const MAX_BRANCH_REPOS = 30;
/** events.detail is truncated in code to 4 KB; the DB check is a looser 16 KB backstop. */
export const MAX_EVENT_DETAIL_BYTES = 4096;
export const MAX_EVENT_DETAIL_DB_BYTES = 16384;
/** gzip'd snapshot body, 1 MiB. */
export const MAX_SNAPSHOT_BYTES = 1048576;
/**
 * gzip'd parsed records of ALL items of one movement (delivery_movements.inputs), 4 MiB. The
 * checklist is rebuilt from it with no Jira call; it is rewritten only when the set of record
 * pointers changes.
 */
export const MAX_INPUTS_BYTES = 4194304;
/** delivery_movements.refresh_error: a short, generic reason (never internals), <= 300 characters. */
export const MAX_REFRESH_ERROR_CHARS = 300;

/** Flux-side edits of one review comment (an overlay; Jira is never written). */
export const MIN_COMMENT_EDIT_CHARS = 20;
export const MAX_COMMENT_EDIT_CHARS = 40000;
export const MAX_COMMENT_EDITS_PER_MOVEMENT = 200;

/** The stored summary body (jsonb), 64 KiB. */
export const MAX_SUMMARY_BYTES = 65536;
export const MOVEMENT_SUMMARY_SOURCE_VALUES = ["ai", "rules"] as const;
export type MovementSummarySource = (typeof MOVEMENT_SUMMARY_SOURCE_VALUES)[number];

/**
 * Bump whenever the record PARSER's output changes (new extractors, service/PR rules, release-row handling).
 * It is part of the stored-inputs version (an older stored copy reads as stale, so the next open re-reads the Jira
 * comments and re-parses them) and of the parsed-record cache key (no parse made by an older parser is reused).
 * 3: services (deploy / restart) from the release page, "no X" lists, PR-junk words, plain-language rollup.
 * 4: clauses about people or the app are not services ("Users log out"), "bundle reload" is the Channelkart Bundle.
 * 5: a "Long lead-in: no service in the rest" sentence of rows 2 / 12 is kept whole as one note ("Transformer registry and report query cache: refresh or restart").
 * 6: a sentence of rows 2 / 12 with no service in it ("Users log out and in ...", "The app is an app-store release, not a restart") is ONE note; "tenant: a; b" is one note.
 * 7: a bracket wrapped over two lines is one text; "(remark)" on its own line and a phrase after a service ("Channel Kart (code); properties need cache clear only") are that service's note.
 * 8: the database rows of a release page (previous data, DB change queries, DB index, UI index db) no longer also become `facts.database.items` / `noSql`: the rows are the single source.
 */
export const PARSER_VERSION = 8;
