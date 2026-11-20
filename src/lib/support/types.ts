// Shared types for support tickets and the daily client support report.
// schema.ts imports from here as types only, so there is no runtime cycle.

export const SUPPORT_CATEGORIES = [
  "bug",
  "understanding",
  "data_issue",
  "data_upload",
  "image_upload",
  "others",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: "Bug",
  understanding: "Understanding",
  data_issue: "Data Issue",
  data_upload: "Data Upload",
  image_upload: "Image Upload",
  others: "Others",
};

export type OwnerSide = "salescode" | "client";

export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type PeriodMode = "mtd" | "ytd" | "custom";

export type SlaTargets = Record<Priority, { responseMin: number; resolutionMin: number }>;

export const DEFAULT_SLA: SlaTargets = {
  P1: { responseMin: 10, resolutionMin: 240 },
  P2: { responseMin: 10, resolutionMin: 480 },
  P3: { responseMin: 30, resolutionMin: 1440 },
  P4: { responseMin: 30, resolutionMin: 2400 },
};

export type OwnershipEvent = { side: OwnerSide; at: Date };

// start/end are HH:MM in IST; days are Sunday-first (0 = Sunday).
export type OfficeHours = { start: string; end: string; days: number[] };

export const DEFAULT_OFFICE_HOURS: OfficeHours = { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5] };

export type ReportTicketInput = {
  issueId: string;
  jiraKey: string;
  summary: string;
  priority: Priority;
  category: SupportCategory | null;
  createdAt: Date;
  resolvedAt: Date | null; // null = open
  firstRespondedAt: Date | null;
  rcaGiven: boolean;
  usersReported: number | null;
  usersImpacted: number | null;
  eta: string | null; // YYYY-MM-DD, Flux value or Jira due-date fallback
  events: OwnershipEvent[]; // live (non-deleted) only
};

export type Cell = { ftd: number; period: number; open: number };

export type SummaryRowKey =
  | "bugs"
  | "rca"
  | "understanding"
  | "data_issue"
  | "data_upload"
  | "image_upload"
  | "others"
  | "total";

export type SupportReportData = {
  projectName: string;
  reportDate: string;
  periodLabel: string;
  sharedBy: string;
  summary: Record<SummaryRowKey, Record<"all" | Priority, Cell>>;
  sla: Record<
    Priority,
    {
      agreed: { responseMin: number; resolutionMin: number };
      avgResponseMin: number | null;
      avgResolutionMin: number | null;
    }
  >;
  impact: {
    jiraKey: string;
    summary: string;
    priority: "P1" | "P2";
    usersReported: number | null;
    usersImpacted: number | null;
  }[];
  openBugs: {
    jiraKey: string;
    summary: string;
    createdOn: string;
    ageDays: number;
    priority: Priority;
    eta: string | null;
  }[];
  uncategorised: { issueId: string; jiraKey: string; summary: string }[];
};
