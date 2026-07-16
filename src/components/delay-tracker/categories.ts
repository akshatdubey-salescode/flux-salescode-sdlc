/** The fixed set of standardized delay reasons — no free-text category. */
export const DELAY_CATEGORIES = [
  { value: "leave", label: "Leave" },
  { value: "third_party_dependency", label: "3rd party dependency" },
  { value: "person_dependency", label: "Person dependency" },
  { value: "dev_delay", label: "Dev Delay" },
  { value: "qa_delay", label: "QA Delay" },
  { value: "resource_unavailability", label: "Resource unavailability" },
  { value: "env_unavailability", label: "Env unavailability" },
  { value: "other_project_task", label: "Other Project task" },
  { value: "other_project_bug", label: "Other Project bug" },
  { value: "estimate_low", label: "Estimate low" },
  { value: "other", label: "Other" },
] as const;

export type DelayCategoryValue = (typeof DELAY_CATEGORIES)[number]["value"];

export const OTHER_PROJECT_CATEGORIES = new Set<DelayCategoryValue>([
  "other_project_task",
  "other_project_bug",
]);

export function categoryLabel(value: string): string {
  return DELAY_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

// Cycled by index — matches the palette already used for pie/donut charts
// elsewhere in the app (developer-insights-client.tsx).
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function categoryColor(value: string): string {
  const idx = DELAY_CATEGORIES.findIndex((c) => c.value === value);
  return CHART_COLORS[(idx < 0 ? 0 : idx) % CHART_COLORS.length];
}
