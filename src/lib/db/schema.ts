import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  boolean,
  uniqueIndex,
  index,
  jsonb,
  integer,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "USER",
  "ADMIN",
  "SUPERUSER",
]);

export const canonicalStatusEnum = pgEnum("canonical_status", [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "IN_QA",
  "DONE",
  "CANCELLED",
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(), // user email (primary key)
  email: text("email").notNull().unique(),
  role: userRoleEnum("role").notNull().default("USER"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Jira Projects — one row per onboarded Jira project
// ---------------------------------------------------------------------------

export const jiraProjects = pgTable(
  "jira_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    jiraBaseUrl: text("jira_base_url").notNull(), // https://org.atlassian.net
    jiraProjectKey: text("jira_project_key").notNull(), // SC, DEV, etc.
    jiraEmail: text("jira_email").notNull(),
    jiraApiToken: text("jira_api_token").notNull(), // TODO: encrypt at rest
    webhookSecret: text("webhook_secret").notNull(), // random hex; included in webhook URL
    isActive: boolean("is_active").notNull().default(true),
    headerImageUrl: text("header_image_url"),
    headerColor: text("header_color"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Auto-discovered Jira custom field ID for multi-user assignee picker.
    // null = not yet attempted, "" = attempted and not found, "customfield_XXXXX" = found.
    multiAssigneeFieldId: text("multi_assignee_field_id"),
    // Auto-discovered Jira custom field IDs for end date / start date.
    // null = not yet attempted, [] = attempted and not found, [...] = found.
    endDateFieldIds: text("end_date_field_ids").array(),
    startDateFieldIds: text("start_date_field_ids").array(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("jira_projects_base_url_key_idx").on(t.jiraBaseUrl, t.jiraProjectKey),
  ]
);

// ---------------------------------------------------------------------------
// Project Status Mappings — maps raw Jira statuses to canonical buckets
// ---------------------------------------------------------------------------

export const projectStatusMappings = pgTable(
  "project_status_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    rawStatus: text("raw_status").notNull(),
    canonicalStatus: canonicalStatusEnum("canonical_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_status_mappings_project_raw_idx").on(
      t.projectId,
      t.rawStatus
    ),
    index("project_status_mappings_project_idx").on(t.projectId),
  ]
);

// ---------------------------------------------------------------------------
// Jira Issues — synced mirror of Jira issues
// ---------------------------------------------------------------------------

export const jiraIssues = pgTable(
  "jira_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    jiraId: text("jira_id").notNull(), // Jira's internal numeric ID
    jiraKey: text("jira_key").notNull(), // e.g. SC-123
    summary: text("summary").notNull(),
    description: text("description"), // Atlassian Document Format as JSON string
    status: text("status").notNull(),
    statusCategory: text("status_category"), // "To Do" | "In Progress" | "Done"
    issueType: text("issue_type").notNull(),
    priority: text("priority"),
    assigneeAccountId: text("assignee_account_id"),
    assigneeEmail: text("assignee_email"),
    assigneeName: text("assignee_name"),
    reporterAccountId: text("reporter_account_id"),
    reporterEmail: text("reporter_email"),
    reporterName: text("reporter_name"),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Emails of additional assignees from the multi-user picker custom field.
    additionalAssigneeEmails: text("additional_assignee_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Stores story points, sprint info, actual start/end, epic link, and any
    // other custom fields without requiring schema migrations.
    customFields: jsonb("custom_fields")
      .$type<Record<string, unknown>>()
      .default({}),
    jiraCreatedAt: timestamp("jira_created_at", { withTimezone: true }),
    jiraUpdatedAt: timestamp("jira_updated_at", { withTimezone: true }),
    // Status-history rollup — derived from the Jira changelog at sync time so
    // we don't persist the per-transition log. Powers throughput, cycle-time,
    // flow-efficiency, velocity, and SLA analytics.
    // Most recent transition from a non-DONE to a DONE canonical status. NULL
    // until the issue is first completed; survives reopen, only advances on a
    // fresh non-DONE→DONE transition.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // When the issue entered its current status. Drives SLA time-in-condition.
    currentStatusSince: timestamp("current_status_since", { withTimezone: true }),
    // Finalized seconds spent per raw status (open current segment excluded).
    timeInStatus: jsonb("time_in_status")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("jira_issues_project_jira_id_idx").on(t.projectId, t.jiraId),
    index("jira_issues_completed_at_idx").on(t.completedAt),
    index("jira_issues_jira_key_idx").on(t.jiraKey),
    index("jira_issues_status_idx").on(t.status),
    index("jira_issues_assignee_email_idx").on(t.assigneeEmail),
    index("jira_issues_additional_assignees_gin_idx").using("gin", t.additionalAssigneeEmails),
    index("jira_issues_project_updated_idx").on(
      t.projectId,
      t.jiraUpdatedAt
    ),
  ]
);

// ---------------------------------------------------------------------------
// SLA condition types — stored as JSONB in sla_rules.conditions
// ---------------------------------------------------------------------------

export type SlaConditionField = "status" | "status_category" | "issue_type" | "priority";
export type SlaConditionOperator = "equals" | "not_equals" | "in";

export type SlaCondition = {
  field: SlaConditionField;
  operator: SlaConditionOperator;
  /** For "in" operator, comma-separated values */
  value: string;
};

export type SlaConditionGroup = {
  operator: "AND";
  conditions: SlaCondition[];
};

/** Top-level condition tree: OR of AND-groups */
export type SlaConditionTree = {
  operator: "OR";
  groups: SlaConditionGroup[];
};

// ---------------------------------------------------------------------------
// SLA Rules — project-level time-bound rules (Iteration 4)
// ---------------------------------------------------------------------------

export const slaRules = pgTable("sla_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => jiraProjects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Compound AND/OR condition tree. OR of AND-groups.
  conditions: jsonb("conditions").$type<SlaConditionTree>().notNull(),
  thresholdHours: numeric("threshold_hours", { precision: 10, scale: 2 }).notNull(),
  notifyAssignee: boolean("notify_assignee").notNull().default(true),
  notifyReporter: boolean("notify_reporter").notNull().default(false),
  additionalEmails: text("additional_emails")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// SLA Violations — one active row per rule/issue breach (Iteration 4)
// ---------------------------------------------------------------------------

export const slaViolations = pgTable(
  "sla_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => slaRules.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => jiraIssues.id, { onDelete: "cascade" }),
    // When the issue entered the monitored condition
    enteredConditionAt: timestamp("entered_condition_at", {
      withTimezone: true,
    }).notNull(),
    violatedAt: timestamp("violated_at", { withTimezone: true }).notNull(),
    // Snapshot of threshold at time of violation (rule may change later)
    thresholdHoursSnapshot: numeric("threshold_hours_snapshot", {
      precision: 10,
      scale: 2,
    }).notNull(),
    actualHours: numeric("actual_hours", { precision: 10, scale: 2 }).notNull(),
    notificationSentAt: timestamp("notification_sent_at", {
      withTimezone: true,
    }),
    notificationStatus: text("notification_status").default("pending"), // pending | sent | failed
    // Set when a tier-2 escalation email is sent (2× threshold)
    escalationNotifiedAt: timestamp("escalation_notified_at", {
      withTimezone: true,
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedReason: text("resolved_reason"), // status_changed | manual_dismiss
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Only one active (unresolved) violation per rule/issue pair
    uniqueIndex("sla_violations_active_idx")
      .on(t.ruleId, t.issueId)
      .where(sql`resolved_at IS NULL`),
    index("sla_violations_rule_idx").on(t.ruleId),
    index("sla_violations_issue_idx").on(t.issueId),
  ]
);

// ---------------------------------------------------------------------------
// Email Notifications — audit log for SLA emails (Iteration 4)
// ---------------------------------------------------------------------------

export const emailNotifications = pgTable("email_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  slaViolationId: uuid("sla_violation_id")
    .notNull()
    .references(() => slaViolations.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: text("status").notNull().default("sent"), // sent | failed
  errorMessage: text("error_message"),
});

// ---------------------------------------------------------------------------
// Project Stakeholders — pre-defined notification recipients per project
// ---------------------------------------------------------------------------

export const projectStakeholders = pgTable(
  "project_stakeholders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_stakeholders_project_email_idx").on(
      t.projectId,
      t.email
    ),
    index("project_stakeholders_project_idx").on(t.projectId),
  ]
);

// ---------------------------------------------------------------------------
// Jira Sync Jobs — tracks async background sync operations
// ---------------------------------------------------------------------------

export const jiraSyncJobs = pgTable(
  "jira_sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    // pending | running | completed | failed
    status: text("status").notNull().default("pending"),
    // Set after the first page returns — null until then
    totalIssues: integer("total_issues"),
    syncedCount: integer("synced_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errorMessages: text("error_messages")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("jira_sync_jobs_project_idx").on(t.projectId),
    index("jira_sync_jobs_status_idx").on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// User Integrations — per-user OAuth tokens for external services
// ---------------------------------------------------------------------------

export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // e.g. "atlassian"
    provider: text("provider").notNull(),
    // OAuth access token — encrypted at rest
    accessToken: text("access_token").notNull(),
    // OAuth refresh token — encrypted at rest; nullable for providers that
    // don't issue refresh tokens
    refreshToken: text("refresh_token"),
    // When the access token expires (UTC). NULL = no expiry info.
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    // Provider-specific identity fields (Atlassian account ID + email)
    atlassianAccountId: text("atlassian_account_id"),
    atlassianEmail: text("atlassian_email"),
    // Atlassian cloud instance ID — needed to build the correct API URL:
    // https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
    atlassianCloudId: text("atlassian_cloud_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_integrations_user_provider_idx").on(t.userId, t.provider),
    index("user_integrations_user_idx").on(t.userId),
  ]
);

// ---------------------------------------------------------------------------
// Requirements — AI-generated requirements built by Business Analysts
// ---------------------------------------------------------------------------

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Platform project this requirement targets (mandatory)
    jiraProjectId: uuid("jira_project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "restrict" }),
    // GitHub repo full name, e.g. "salescode-ai/schemes-service"
    githubRepoName: text("github_repo_name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    acceptanceCriteria: text("acceptance_criteria"),
    priority: text("priority", {
      enum: ["low", "medium", "high", "critical"],
    })
      .notNull()
      .default("medium"),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    // Set once the requirement has been published to Jira, e.g. "SC-123"
    jiraIssueKey: text("jira_issue_key"),
    // Citations and synthesis from charjan stored for audit/reference
    charjanContext: jsonb("charjan_context").$type<{
      answer: string;
      citations: { id: string; title: string; snippet: string; relevance_score: number }[];
    }>(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("requirements_project_idx").on(t.jiraProjectId),
    index("requirements_repo_idx").on(t.githubRepoName),
    index("requirements_created_by_idx").on(t.createdBy),
    index("requirements_status_idx").on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// Observer Boards — manager-defined boards for watching specific developers
// ---------------------------------------------------------------------------

export const observerBoards = pgTable("observer_boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  managerName: text("manager_name"),
  managerEmail: text("manager_email"),
  stalenessThresholdDays: integer("staleness_threshold_days").notNull().default(5),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const observerBoardMembers = pgTable(
  "observer_board_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => observerBoards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    jiraAccountId: text("jira_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("observer_board_members_board_email_idx").on(t.boardId, t.email),
    index("observer_board_members_board_idx").on(t.boardId),
  ]
);

// ---------------------------------------------------------------------------
// Feature Requests — submitted by org members to propose new product features
// ---------------------------------------------------------------------------

export const featureRequests = pgTable(
  "feature_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    useCaseProblem: text("use_case_problem"),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => users.id),
    submittedByEmail: text("submitted_by_email").notNull(),
    submittedByName: text("submitted_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feature_requests_submitted_by_idx").on(t.submittedBy),
    index("feature_requests_priority_idx").on(t.priority),
    index("feature_requests_created_at_idx").on(t.createdAt),
  ]
);

// ---------------------------------------------------------------------------
// Freshdesk Tickets — synced mirror of Freshdesk support tickets
// ---------------------------------------------------------------------------

export const freshdeskTickets = pgTable(
  "freshdesk_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Flux project this ticket belongs to (used to scope the dashboard)
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    // Freshdesk ticket number (plain integer, e.g. 1042)
    fdTicketId: integer("fd_ticket_id").notNull(),
    subject: text("subject").notNull(),
    // Freshdesk numeric status: 2=Open 3=Pending 4=Resolved 5=Closed
    fdStatus: integer("fd_status").notNull(),
    fdStatusLabel: text("fd_status_label").notNull(),
    // Freshdesk numeric priority: 1=Low 2=Medium 3=High 4=Urgent
    fdPriority: integer("fd_priority").notNull(),
    fdPriorityLabel: text("fd_priority_label").notNull(),
    ticketType: text("ticket_type"),
    requesterName: text("requester_name"),
    requesterEmail: text("requester_email"),
    fdCompanyId: text("fd_company_id"),
    fdCompanyName: text("fd_company_name"),
    dueBy: timestamp("due_by", { withTimezone: true }),
    frDueBy: timestamp("fr_due_by", { withTimezone: true }),
    isEscalated: boolean("is_escalated").notNull().default(false),
    frEscalated: boolean("fr_escalated").notNull().default(false),
    // Linked Jira issue — populated when customfield_11699 on the Jira issue
    // matches this ticket's fdTicketId
    linkedJiraIssueId: uuid("linked_jira_issue_id").references(
      () => jiraIssues.id,
      { onDelete: "set null" }
    ),
    linkedJiraKey: text("linked_jira_key"),
    linkedJiraStatus: text("linked_jira_status"),
    linkedJiraAssigneeName: text("linked_jira_assignee_name"),
    fdCreatedAt: timestamp("fd_created_at", { withTimezone: true }),
    fdUpdatedAt: timestamp("fd_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("freshdesk_tickets_project_fd_id_idx").on(
      t.projectId,
      t.fdTicketId
    ),
    index("freshdesk_tickets_project_idx").on(t.projectId),
    index("freshdesk_tickets_status_idx").on(t.fdStatus),
    index("freshdesk_tickets_linked_jira_idx").on(t.linkedJiraIssueId),
  ]
);

// ---------------------------------------------------------------------------
// Feature Flags — runtime toggles for gating features without deploys
// ---------------------------------------------------------------------------

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type JiraProject = typeof jiraProjects.$inferSelect;
export type NewJiraProject = typeof jiraProjects.$inferInsert;
export type JiraIssue = typeof jiraIssues.$inferSelect;
export type NewJiraIssue = typeof jiraIssues.$inferInsert;
export type SlaRule = typeof slaRules.$inferSelect;
export type SlaViolation = typeof slaViolations.$inferSelect;
export type ProjectStatusMapping = typeof projectStatusMappings.$inferSelect;
export type NewProjectStatusMapping =
  typeof projectStatusMappings.$inferInsert;
export type CanonicalStatus = (typeof canonicalStatusEnum.enumValues)[number];
export type JiraSyncJob = typeof jiraSyncJobs.$inferSelect;
export type ProjectStakeholder = typeof projectStakeholders.$inferSelect;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type Requirement = typeof requirements.$inferSelect;
export type NewRequirement = typeof requirements.$inferInsert;
export type ObserverBoard = typeof observerBoards.$inferSelect;
export type NewObserverBoard = typeof observerBoards.$inferInsert;
export type ObserverBoardMember = typeof observerBoardMembers.$inferSelect;
export type NewObserverBoardMember = typeof observerBoardMembers.$inferInsert;
export type FeatureRequest = typeof featureRequests.$inferSelect;
export type NewFeatureRequest = typeof featureRequests.$inferInsert;
export type FreshdeskTicket = typeof freshdeskTickets.$inferSelect;
export type NewFreshdeskTicket = typeof freshdeskTickets.$inferInsert;
export type FeatureFlag = typeof featureFlags.$inferSelect;

