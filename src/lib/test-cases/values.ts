// Controlled vocabularies for Test Case management. The value lists are
// imported by the Drizzle schema (pgEnum) so the DB and TypeScript share one
// source, the same way DELAY_CATEGORY_VALUES does.

/**
 * What a test case exercises. The sheets' "TC TYPE" and "TC CLASSIFICATION"
 * columns hold this in some tabs and the polarity below in others, so both
 * columns are read together (see normalizeTypeColumns).
 */
export const TC_CATEGORY_VALUES = [
  "functional",
  "integration",
  "regression",
  "ui",
  "api",
  "security",
  "boundary",
  "validation",
  "data_validation",
  "non_functional",
  "other",
  "unspecified",
] as const;
export type TcCategory = (typeof TC_CATEGORY_VALUES)[number];

export const TC_CATEGORY_LABELS: Record<TcCategory, string> = {
  functional: "Functional",
  integration: "Integration",
  regression: "Regression",
  ui: "UI",
  api: "API",
  security: "Security",
  boundary: "Boundary",
  validation: "Validation",
  data_validation: "Data Validation",
  non_functional: "Non-functional",
  other: "Other",
  unspecified: "Unspecified",
};

/** Whether the case checks the happy path, a failure path, or an edge. */
export const TC_POLARITY_VALUES = ["positive", "negative", "edge"] as const;
export type TcPolarity = (typeof TC_POLARITY_VALUES)[number];

export const TC_POLARITY_LABELS: Record<TcPolarity, string> = {
  positive: "Positive",
  negative: "Negative",
  edge: "Edge case",
};

export const TC_PRIORITY_VALUES = ["P1", "P2", "P3", "P4"] as const;
export type TcPriority = (typeof TC_PRIORITY_VALUES)[number];

export const TC_SEVERITY_VALUES = ["critical", "high", "major", "medium", "low"] as const;
export type TcSeverity = (typeof TC_SEVERITY_VALUES)[number];

export const TC_RESULT_VALUES = ["pass", "fail", "blocked", "not_run"] as const;
export type TcResult = (typeof TC_RESULT_VALUES)[number];

export const TC_ROUND_STATUS_VALUES = ["in_review", "changes_requested", "approved"] as const;
export type TcRoundStatus = (typeof TC_ROUND_STATUS_VALUES)[number];

export const TC_ROUND_STATUS_LABELS: Record<TcRoundStatus, string> = {
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export const TC_SOURCE_VALUES = ["google_sheet", "xlsx"] as const;
export type TcSource = (typeof TC_SOURCE_VALUES)[number];

export const TC_FILE_KIND_VALUES = [
  "testcases",
  "signoff_dev",
  "signoff_tester",
  "llm_feedback",
  "reviewer_feedback",
] as const;
export type TcFileKind = (typeof TC_FILE_KIND_VALUES)[number];

export const TC_REVIEWER_STATE_VALUES = ["pending", "approved", "changes_requested"] as const;
export type TcReviewerState = (typeof TC_REVIEWER_STATE_VALUES)[number];

export const TC_SIGNOFF_ROLE_VALUES = ["dev", "tester"] as const;
export type TcSignoffRole = (typeof TC_SIGNOFF_ROLE_VALUES)[number];

/** A thread entry is either a plain comment or the note that came with a decision. */
export const TC_COMMENT_KIND_VALUES = ["comment", "approved", "changes_requested"] as const;
export type TcCommentKind = (typeof TC_COMMENT_KIND_VALUES)[number];

export const TC_REVIEWER_STATE_LABELS: Record<TcReviewerState, string> = {
  pending: "Pending review",
  approved: "Approved",
  changes_requested: "Changes requested",
};
