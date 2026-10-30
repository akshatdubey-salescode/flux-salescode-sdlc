// Display text for AI findings (safe for client components: no server imports).

import type { FindingCategory } from "./baseline";

export const FINDING_CATEGORY_LABELS: Record<FindingCategory, string> = {
  missing_coverage: "Missing coverage",
  missing_negative_case: "Missing negative case",
  vague_expected_result: "Vague expected result",
  untestable_step: "Untestable step",
  duplicate: "Duplicate",
  contradicts_requirement: "Contradicts requirement",
  wrong_priority_or_type: "Priority / type",
  dependent_module_not_covered: "Dependent module not covered",
  outdated_by_change: "Outdated by change",
  prior_feedback_not_addressed: "Earlier feedback not addressed",
  missing_non_functional: "Missing non-functional case",
  missing_data_or_rollout_case: "Missing data / rollout case",
  nonstandard_value: "Non-standard value",
  other: "Other",
};
