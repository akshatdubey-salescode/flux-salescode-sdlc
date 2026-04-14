import type { SlaConditionTree, SlaConditionGroup, SlaCondition } from "@/lib/db/schema";

export const FIELD_LABELS: Record<string, string> = {
  priority: "Priority",
  status: "Status",
  status_category: "Status Category",
  issue_type: "Issue Type",
};

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "is",
  not_equals: "is not",
  in: "is any of",
};

export const CONDITION_FIELDS = [
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "status_category", label: "Status Category" },
  { value: "issue_type", label: "Issue Type" },
] as const;

export const CONDITION_OPERATORS = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "in", label: "is any of" },
] as const;

export function conditionToHuman(
  field: string,
  operator: string,
  value: string
): string {
  const fieldLabel = FIELD_LABELS[field] ?? field;
  const operatorLabel = OPERATOR_LABELS[operator] ?? operator;
  if (operator === "in") {
    const vals = value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .join(", ");
    return `${fieldLabel} ${operatorLabel} ${vals}`;
  }
  return `${fieldLabel} ${operatorLabel} ${value}`;
}

export function conditionTreeToHuman(tree: SlaConditionTree): string {
  return tree.groups
    .map((g) =>
      g.conditions
        .map((c) => conditionToHuman(c.field, c.operator, c.value))
        .join(" AND ")
    )
    .join(" OR ");
}

export function formatThreshold(hours: string | number): string {
  const h = typeof hours === "string" ? parseFloat(hours) : hours;
  if (isNaN(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) {
    const rounded = Math.round(h * 10) / 10;
    return `${rounded}h`;
  }
  const days = Math.floor(h / 24);
  const remaining = Math.round((h % 24) * 10) / 10;
  if (remaining === 0) return `${days}d`;
  return `${days}d ${remaining}h`;
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 60_000) return "just now";
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Default condition factories
// ---------------------------------------------------------------------------

export function defaultCondition(): SlaCondition {
  return { field: "priority", operator: "equals", value: "" };
}

export function defaultGroup(): SlaConditionGroup {
  return { operator: "AND", conditions: [defaultCondition()] };
}

export function defaultConditionTree(): SlaConditionTree {
  return { operator: "OR", groups: [defaultGroup()] };
}
