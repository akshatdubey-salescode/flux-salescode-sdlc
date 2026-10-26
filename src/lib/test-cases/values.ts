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
  // The stored value stays changes_requested; the label says what the submitter has to do.
  changes_requested: "Resubmit TCs",
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

/**
 * `re_review`: this reviewer had requested changes, the sheet was resubmitted,
 * and they have not looked again. `overridden`: another reviewer waived their
 * feedback so the review could move on.
 */
export const TC_REVIEWER_STATE_VALUES = ["pending", "approved", "changes_requested", "re_review", "overridden"] as const;
export type TcReviewerState = (typeof TC_REVIEWER_STATE_VALUES)[number];

export const TC_SIGNOFF_ROLE_VALUES = ["dev", "tester"] as const;
export type TcSignoffRole = (typeof TC_SIGNOFF_ROLE_VALUES)[number];

/**
 * A thread entry is a plain comment, the note that came with a decision, or an
 * override (a reviewer waived open feedback to approve; the body is the reason).
 */
export const TC_COMMENT_KIND_VALUES = ["comment", "approved", "changes_requested", "override"] as const;
export type TcCommentKind = (typeof TC_COMMENT_KIND_VALUES)[number];

/** Who raised a feedback item. LLM findings will arrive as `llm` and behave like reviewer feedback. */
export const TC_FEEDBACK_SOURCE_VALUES = ["reviewer", "llm", "system"] as const;
export type TcFeedbackSource = (typeof TC_FEEDBACK_SOURCE_VALUES)[number];

/**
 * The AI review sits in every round's reviewer list under this reserved address so the existing rules
 * (a standing change request blocks approval, carry-over on resubmission, override) apply to it unchanged.
 * It is never a person: it cannot be assigned, cannot decide, and it never approves.
 */
export const AI_REVIEWER_EMAIL = "ai-review@flux.local";
export const AI_REVIEWER_NAME = "AI review";
export const isAiReviewer = (email: string | null | undefined): boolean => (email ?? "").trim().toLowerCase() === AI_REVIEWER_EMAIL;

/** How the AI reviewer's states read (it isn't "waiting to re-review" a person's change; it is running or has findings). */
export const AI_REVIEWER_STATE_LABELS: Record<TcReviewerState, string> = {
  pending: "No findings",
  approved: "No findings",
  re_review: "Reviewing",
  changes_requested: "Findings raised",
  overridden: "Findings overridden",
};

export const TC_REVIEWER_STATE_LABELS: Record<TcReviewerState, string> = {
  pending: "Pending review",
  approved: "Approved",
  changes_requested: "Changes requested",
  re_review: "Waiting to re-review",
  overridden: "Feedback overridden",
};

/** The most tabs of one workbook that can make up one item's test cases. */
export const MAX_TABS_PER_ITEM = 10;
