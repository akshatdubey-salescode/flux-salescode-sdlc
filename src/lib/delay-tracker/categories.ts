/** Values persisted by the delay_reason_category database enum. */
export const DELAY_CATEGORY_VALUES = [
  "leave",
  "third_party_dependency",
  "person_dependency",
  "dev_delay",
  "qa_delay",
  "resource_unavailability",
  "env_unavailability",
  "other_project_task",
  "other_project_bug",
  "estimate_low",
  "other",
] as const;

export type DelayCategoryValue = (typeof DELAY_CATEGORY_VALUES)[number];

const CATEGORY_LABELS = {
  leave: "Leave",
  third_party_dependency: "3rd party dependency",
  person_dependency: "Person dependency",
  dev_delay: "Dev Delay",
  qa_delay: "QA Delay",
  resource_unavailability: "Resource unavailability",
  env_unavailability: "Env unavailability",
  other_project_task: "Other Project task",
  other_project_bug: "Other Project bug",
  estimate_low: "Estimate low",
  other: "Other",
} satisfies Record<DelayCategoryValue, string>;

/** Labels for the fixed set of standardized delay reasons. */
export const DELAY_CATEGORIES = DELAY_CATEGORY_VALUES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const OTHER_PROJECT_CATEGORIES = new Set<DelayCategoryValue>([
  "other_project_task",
  "other_project_bug",
]);

export function categoryLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value)
    ? CATEGORY_LABELS[value as DelayCategoryValue]
    : value;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function categoryColor(value: string): string {
  const index = DELAY_CATEGORIES.findIndex((category) => category.value === value);
  return CHART_COLORS[(index < 0 ? 0 : index) % CHART_COLORS.length];
}
