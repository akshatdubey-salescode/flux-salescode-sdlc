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
  doublePrecision,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { DELAY_CATEGORY_VALUES } from "../delay-tracker/categories";
import { DELIVERY_STATUS_VALUES } from "../deliveries/status";

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

// "What's New" release notes. INFO appears only in the notification bell;
// ALERT additionally pops up as a modal the first time a user sees it.
export const releaseNoteTypeEnum = pgEnum("release_note_type", [
  "INFO",
  "ALERT",
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(), // user email (primary key)
  email: text("email").notNull().unique(),
  role: userRoleEnum("role").notNull().default("USER"),
  // Resolved once via Jira /user/search?query={email}. Survives Atlassian
  // privacy settings that hide emailAddress on issue payloads — we link by
  // accountId instead. null = not yet attempted/resolved.
  jiraAccountId: text("jira_account_id"),
  // Grants delivery-tracker management (create/add/remove) to a USER who
  // isn't an ADMIN — orthogonal to the role hierarchy, not another tier of
  // it, so it lives as its own flag rather than a new `role` value. Granted
  // via the Superuser "Delivery Managers" tool.
  canManageDeliveries: boolean("can_manage_deliveries").notNull().default(false),
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
    // Freshdesk company ID this project's Client Issue Tracking is scoped to.
    // null = Freshdesk integration disabled for the project; set = enabled.
    freshdeskCompanyId: text("freshdesk_company_id"),
    headerImageUrl: text("header_image_url"),
    headerColor: text("header_color"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Auto-discovered Jira custom field IDs for multi-user assignee pickers.
    // A project may use more than one (e.g. both an "Assignee" and a "Multiple
    // Assignee" people field); every match feeds additional_assignee_emails.
    // null = not yet attempted, [] = attempted and none found, [...] = found.
    multiAssigneeFieldIds: text("multi_assignee_field_ids").array(),
    // Auto-discovered Jira custom field IDs for end date / start date.
    // null = not yet attempted, [] = attempted and not found, [...] = found.
    endDateFieldIds: text("end_date_field_ids").array(),
    startDateFieldIds: text("start_date_field_ids").array(),
    // Auto-discovered Jira custom field IDs for the "Actual start" / "Actual
    // end" datetime fields (distinct from the planned start/due date fields
    // above). When populated these are the preferred source for the developer
    // work-window used by the performance-review MTTR / sprint-commitment
    // metrics; the changelog-derived dev_started_at / dev_completed_at on the
    // issue are the fallback. Same null/[]/[...] semantics as above.
    actualStartFieldIds: text("actual_start_field_ids").array(),
    actualEndFieldIds: text("actual_end_field_ids").array(),
    // Auto-discovered Jira custom field IDs for task complexity (1–5 scale) and
    // the "Issue Owner" user-picker field. Both feed the performance-review
    // rating engine. Same null/[]/[...] semantics as above.
    complexityFieldIds: text("complexity_field_ids").array(),
    issueOwnerFieldIds: text("issue_owner_field_ids").array(),
    // Auto-discovered Jira custom field IDs for the "Dev Owner" user-picker.
    // Performance-review task credit goes to the Dev Owner when set, falling
    // back to the issue Assignee. Like Issue Owner, the site has several distinct
    // fields all named "Dev Owner", so this is disambiguated to the one each
    // project actually populates. Same null/[]/[...] semantics as above.
    devOwnerFieldIds: text("dev_owner_field_ids").array(),
    // Auto-discovered Jira custom field IDs for the "Environment" dropdown
    // (e.g. Prod/Demo/UAT) that feeds the bug-summary env column. The system
    // `environment` field is an unreliable fallback — most projects record it
    // in this custom select instead. Same null/[]/[...] semantics as above.
    environmentFieldIds: text("environment_field_ids").array(),
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
    // Jira's status-category NAME, verbatim from their API — NOT the fixed
    // 3-value enum it looks like. Different Jira sites/instances label the
    // same green "done" bucket differently (this org alone has both "Done"
    // and "Complete" in the wild). Never compare this directly for "is done"
    // — use isDoneOrCancelled() (bug-summary.ts), which prefers the curated
    // projectStatusMappings row and only falls back to this name.
    statusCategory: text("status_category"),
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
    // Developer work-window endpoints, changelog-derived (PDF §5). These bound
    // the time the issue was actively being worked, so the performance-review
    // MTTR / sprint-commitment metrics don't blame the developer for the days a
    // ticket sits unassigned in the backlog or waiting in QA after handoff.
    //   dev_started_at  — first transition INTO a canonical IN_PROGRESS status.
    //   dev_completed_at — first transition INTO a canonical IN_QA or DONE
    //                      status at/after dev_started_at (i.e. dev hands the
    //                      ticket off). Distinct from completed_at, which is the
    //                      DONE transition only. Both NULL until they occur.
    devStartedAt: timestamp("dev_started_at", { withTimezone: true }),
    devCompletedAt: timestamp("dev_completed_at", { withTimezone: true }),
    // When the issue entered its current status. Drives SLA time-in-condition.
    currentStatusSince: timestamp("current_status_since", { withTimezone: true }),
    // When the current assignee took ownership — most recent assignee change
    // landing on them, or issue creation if assigned at creation and never
    // reassigned. NULL when unassigned. Powers the "assigned ≥24h ago" filter
    // on the unplanned-assignees view so freshly-assigned work isn't penalized.
    assigneeSince: timestamp("assignee_since", { withTimezone: true }),
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
    index("jira_issues_reporter_email_idx").on(t.reporterEmail),
    index("jira_issues_additional_assignees_gin_idx").using("gin", t.additionalAssigneeEmails),
    index("jira_issues_project_updated_idx").on(
      t.projectId,
      t.jiraUpdatedAt
    ),
  ]
);

// ---------------------------------------------------------------------------
// Jira Assignee Changes — per-event log of assignee transitions, parsed from
// the changelog at sync time. Unlike the status rollup, this detail can't be
// rolled up: detecting "who removed themselves" requires the individual events.
// Powers the self-deassigners view (Top developers reassigning work off
// themselves).
// ---------------------------------------------------------------------------

export const jiraAssigneeToKindEnum = pgEnum("jira_assignee_to_kind", [
  "unassigned",
  "reporter",
  "other",
]);

export const jiraAssigneeChanges = pgTable(
  "jira_assignee_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => jiraIssues.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    // Jira changelog history id — stable per transition, used for idempotent
    // re-sync (the full changelog is re-parsed on every sync).
    changelogHistoryId: text("changelog_history_id").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
    // Who made the change.
    authorAccountId: text("author_account_id"),
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    // Previous assignee (the person work moved off of).
    fromAccountId: text("from_account_id"),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    // New assignee (null when unassigned).
    toAccountId: text("to_account_id"),
    toEmail: text("to_email"),
    toName: text("to_name"),
    // Author removed themselves as assignee (author === previous assignee).
    isSelfRemoval: boolean("is_self_removal").notNull().default(false),
    toKind: jiraAssigneeToKindEnum("to_kind").notNull().default("other"),
  },
  (t) => [
    uniqueIndex("jira_assignee_changes_issue_history_idx").on(
      t.issueId,
      t.changelogHistoryId
    ),
    index("jira_assignee_changes_self_removal_idx").on(
      t.isSelfRemoval,
      t.changedAt
    ),
    index("jira_assignee_changes_author_idx").on(
      t.authorAccountId,
      t.changedAt
    ),
    index("jira_assignee_changes_project_idx").on(t.projectId),
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
    // Google identity (for provider='google')
    googleEmail: text("google_email"),
    // Google Calendar incremental sync token. NULL = next sync is a full
    // window pull; set to nextSyncToken after a successful sync. Reset to
    // NULL on 410 GONE to trigger a fresh full sync.
    googleSyncToken: text("google_sync_token"),
    googleLastSyncedAt: timestamp("google_last_synced_at", { withTimezone: true }),
    // When we last did a *full window* pull (as opposed to an incremental
    // syncToken sync). Incremental sync never delivers future occurrences of
    // recurring series that nobody edits, so they fall past the forward
    // horizon over time. We periodically re-run a full pull to re-materialize
    // the window. NULL = never full-synced → next sync is a full pull.
    googleFullSyncedAt: timestamp("google_full_synced_at", { withTimezone: true }),
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
// Calendar Events — synced mirror of Google Calendar events, per attendee user.
// One row per (user, event-instance). Recurring events are expanded
// (singleEvents=true at fetch time) so each occurrence is its own row.
// ---------------------------------------------------------------------------

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Google's per-calendar event id (stable per occurrence with singleEvents=true)
    googleEventId: text("google_event_id").notNull(),
    // Stable across calendars for the same meeting — lets us dedupe later
    // ("how many distinct meetings did the team have?") without changing schema.
    iCalUid: text("ical_uid"),
    summary: text("summary"),
    // Google event visibility: "default" | "public" | "private" | "confidential".
    // Treat private/confidential as busy-only (don't show summary to managers).
    visibility: text("visibility"),
    status: text("status"), // confirmed | tentative | cancelled
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    isAllDay: boolean("is_all_day").notNull().default(false),
    organizerEmail: text("organizer_email"),
    // Attendee emails (lowercased). Lets the UI render "meeting with A, B, C"
    // and lets future dedup find overlapping meeting rows.
    attendeeEmails: text("attendee_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    htmlLink: text("html_link"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("calendar_events_user_event_idx").on(t.userId, t.googleEventId),
    index("calendar_events_user_starts_idx").on(t.userId, t.startsAt),
    index("calendar_events_ical_uid_idx").on(t.iCalUid),
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
  // Set only on boards created by a Keka bulk-provision run; NULL for every
  // hand-made board. Rollback deletes strictly by this id, so manual boards
  // (NULL) can never be touched. See observerBoardProvisionRuns.
  provisionRunId: uuid("provision_run_id").references(
    () => observerBoardProvisionRuns.id,
    { onDelete: "set null" }
  ),
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

// One row per Keka bulk-provision run (superuser → /superuser/provision-teams).
// Records provenance so a run can be rolled back precisely: deleting the run's
// boards via observer_boards.provision_run_id (cascade removes their members)
// and nothing else. Purely additive — its existence never affects manual boards.
export const observerBoardProvisionRuns = pgTable("observer_board_provision_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  triggeredBy: text("triggered_by")
    .notNull()
    .references(() => users.id),
  source: text("source").notNull().default("keka_direct_reports"),
  status: text("status", { enum: ["active", "rolled_back"] })
    .notNull()
    .default("active"),
  boardsCreated: integer("boards_created").notNull().default(0),
  membersCreated: integer("members_created").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
});

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
    // Plain-text ticket body (Freshdesk `description_text`). Nullable because the
    // automation-rule webhook only includes it when configured to send it.
    description: text("description"),
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
// GitHub Orgs — the organisations we mirror repos from. Each carries its own
// fine-grained PAT (encrypted at rest, like jira_projects.jira_api_token),
// since a fine-grained PAT is scoped to a single org. Managed via the superuser
// page; the sync iterates every active org using its own token.
// ---------------------------------------------------------------------------

export const githubOrgs = pgTable("github_orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The org login, e.g. "salescode-ai".
  login: text("login").notNull().unique(),
  // How this org's token is obtained:
  //  'pat' = apiToken is a long-lived fine-grained PAT, tied to whoever
  //          generated it (see apiToken below).
  //  'app' = appInstallationId identifies this org's GitHub App installation;
  //          the token is a short-lived installation access token minted on
  //          demand via app-auth.ts (see githubAppCredentials). Org-level,
  //          not tied to any one person's account.
  authMode: text("auth_mode").notNull().default("pat"),
  // Fine-grained PAT with Contents + Metadata read on the org's repos.
  // Encrypted at rest; decrypt() before use. Only set when authMode='pat'.
  apiToken: text("api_token"),
  // This org's GitHub App installation id (from installing the shared App in
  // githubAppCredentials on this org). Only set when authMode='app'.
  appInstallationId: text("app_installation_id"),
  // How this org's repos are discovered:
  //  'auto'   = list the whole org via GET /orgs/{org}/repos (needs an org-wide
  //             PAT, or an App installation with "All repositories" access).
  //             Repos are mirrored and pruned automatically.
  //  'manual' = the PAT can only read specific repos (e.g. a personal PAT with
  //             partial access to an org you have no org PAT for). Repos aren't
  //             auto-listed or pruned — a superuser registers them by full name
  //             and the sync refreshes each one individually via GET /repos.
  discoveryMode: text("discovery_mode").notNull().default("auto"),
  isActive: boolean("is_active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  // Superuser who added the org; null for the seeded legacy org.
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A single shared GitHub App's credentials — installed across every org that
// runs authMode='app' (see githubOrgs.appInstallationId). Expected to hold
// exactly one row; kept as its own table rather than columns on githubOrgs
// since the App itself is one entity shared by many org installations, not
// per-org data.
export const githubAppCredentials = pgTable("github_app_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  // PEM private key, encrypted at rest; decrypt() before use.
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// GitHub Repos — synced mirror of each org's repositories. Scopes the LOC
// metric and lets a superuser untrack noisy repos (archived, vendored mirrors)
// so they're excluded from stats collection and the dashboard.
// ---------------------------------------------------------------------------

export const githubRepos = pgTable(
  "github_repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The org this repo belongs to. Drives per-org sync/prune and which PAT to
    // use. Nullable only for legacy rows pre-multi-org; backfilled by the seed.
    orgId: uuid("org_id").references(() => githubOrgs.id, { onDelete: "cascade" }),
    // GitHub's stable numeric repo id — the natural key for upsert.
    githubRepoId: integer("github_repo_id").notNull(),
    name: text("name").notNull(), // e.g. "schemes-service"
    fullName: text("full_name").notNull(), // e.g. "salescode-ai/schemes-service"
    // The branch contributor-stats aggregates over. Informational here.
    defaultBranch: text("default_branch"),
    // Extra branches (beyond the default) to fold into this repo's LOC, set
    // per-repo by a superuser. GitHub's contributor-stats API only ever reports
    // the default branch, so any repo with a non-empty list is forced onto the
    // git collector (stats_mode='git'), which runs `git log` over the union of
    // {default, ...extraBranches} — commits shared across branches are deduped
    // by SHA, so nothing is double-counted. Empty = default branch only.
    extraBranches: text("extra_branches")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isPrivate: boolean("is_private").notNull().default(false),
    language: text("language"),
    // false = excluded from stats sync and the dashboard.
    isTracked: boolean("is_tracked").notNull().default(true),
    // How this repo's line stats are sourced: 'api' = GitHub contributor-stats
    // (fast, default); 'git' = computed locally via `git log --numstat` because
    // GitHub disables line stats for repos past ~10k commits. 'git' repos are
    // owned by the git collector and skipped by the API/cron path.
    statsMode: text("stats_mode").notNull().default("api"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    // When contributor stats were last successfully pulled for this repo.
    statsSyncedAt: timestamp("stats_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("github_repos_github_repo_id_idx").on(t.githubRepoId),
    index("github_repos_tracked_idx").on(t.isTracked),
    index("github_repos_org_idx").on(t.orgId),
  ]
);

// ---------------------------------------------------------------------------
// GitHub Accounts — identity bridge from a GitHub login to an app user.
// Contributor stats are attributed by GitHub account, not commit email, so we
// need this mapping to roll LOC up per person. Auto-resolved by email where
// possible (resolved_via = 'email_auto'); the rest are mapped by a superuser
// (resolved_via = 'manual'). Bot accounts (e.g. dependabot[bot]) are flagged
// and excluded from the dashboard.
// ---------------------------------------------------------------------------

export const githubAccounts = pgTable(
  "github_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubLogin: text("github_login").notNull(),
    githubUserId: integer("github_user_id"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    // The app user this GitHub account belongs to. null = not yet resolved.
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    // How userId was set: 'email_auto' | 'manual'. null while unresolved.
    resolvedVia: text("resolved_via"),
    isBot: boolean("is_bot").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("github_accounts_login_idx").on(t.githubLogin),
    index("github_accounts_user_idx").on(t.userId),
  ]
);

// ---------------------------------------------------------------------------
// GitHub Contributor Stats — the granular LOC store, one row per
// (repo, login, week). Sourced from GET /repos/{o}/{r}/stats/contributors,
// whose weekly buckets (UTC, Sunday-aligned) carry additions/deletions/commits
// on the default branch. Net LOC = additions − deletions. GitHub recomputes the
// full history on each call, so the upsert overwrites a/d/c outright.
// ---------------------------------------------------------------------------

export const githubContributorStats = pgTable(
  "github_contributor_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => githubRepos.id, { onDelete: "cascade" }),
    githubLogin: text("github_login").notNull(),
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    commits: integer("commits").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("github_contributor_stats_repo_login_week_idx").on(
      t.repoId,
      t.githubLogin,
      t.weekStart
    ),
    index("github_contributor_stats_week_idx").on(t.weekStart),
    index("github_contributor_stats_login_idx").on(t.githubLogin),
  ]
);

// ---------------------------------------------------------------------------
// GitHub Sync Jobs — tracks async background sync operations (org-wide, so no
// project scope, unlike jira_sync_jobs). Powers the superuser progress UI.
// ---------------------------------------------------------------------------

export const githubSyncJobs = pgTable(
  "github_sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // pending | running | completed | failed
    status: text("status").notNull().default("pending"),
    // Set after the repo list returns — null until then.
    totalRepos: integer("total_repos"),
    syncedRepos: integer("synced_repos").notNull().default(0),
    statsRowsUpserted: integer("stats_rows_upserted").notNull().default(0),
    accountsResolved: integer("accounts_resolved").notNull().default(0),
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
  (t) => [index("github_sync_jobs_status_idx").on(t.status)]
);

// ---------------------------------------------------------------------------
// GitHub Pull Requests — one row per (repo, PR number). List-endpoint fields
// (title, branch, author, dates) are cheap and always upserted; additions/
// deletions require fetching the PR's changed-file diffs (to strip whole-line
// comments — see comment-lines.ts), so they're fetched only for PRs that
// already pass the cheap Jira-key/author/quarter filters in loc-sync (see
// statsFetchedAt) — keeps GitHub API cost proportional to real matches, not
// total PR volume.
// ---------------------------------------------------------------------------

export const githubPullRequests = pgTable(
  "github_pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => githubRepos.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    headRef: text("head_ref").notNull(), // branch name
    authorLogin: text("author_login"),
    state: text("state").notNull(), // open | closed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    // Code-only (whole-line comments excluded) when statsMethod = "code_only";
    // GitHub's raw diff counts (comments included) for any file whose patch
    // wasn't available to classify (binary / too-large diff).
    additions: integer("additions"),
    deletions: integer("deletions"),
    // Set once the diff-stats fetch has run, so a re-sync doesn't re-fetch
    // stats for a PR already priced out. Distinct from "raw" so a row fetched
    // before comment-exclusion shipped is correctly treated as stale and
    // refetched, rather than silently reused under different semantics.
    statsMethod: text("stats_method"), // "code_only" | null (not yet fetched, or fetched pre-comment-exclusion)
    statsFetchedAt: timestamp("stats_fetched_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("github_pull_requests_repo_number_idx").on(t.repoId, t.number),
    index("github_pull_requests_updated_idx").on(t.updatedAt),
    index("github_pull_requests_author_idx").on(t.authorLogin),
  ]
);

// ---------------------------------------------------------------------------
// Jira Issue LOC — precomputed, cached lines-of-code total per (Jira key,
// quarter), summed across every qualifying PR (same assignee as the issue,
// Jira key found case-insensitively in the PR title or branch, and either the
// PR's created or merged date falls inside the quarter). Written only by
// loc-sync's periodic/manual job — the scorecard build reads this table, it
// never recomputes LOC itself.
// ---------------------------------------------------------------------------

export const jiraIssueLoc = pgTable(
  "jira_issue_loc",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jiraKey: text("jira_key").notNull(), // upper-cased, e.g. "SC-123"
    quarterKey: text("quarter_key").notNull(),
    totalAdditions: integer("total_additions").notNull().default(0),
    totalDeletions: integer("total_deletions").notNull().default(0),
    prCount: integer("pr_count").notNull().default(0),
    prNumbers: integer("pr_numbers")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    // Whoever actually authored the matched PR(s) — Dev Owner if any of them
    // wrote one, else Assignee (see resolvePrCredit in loc-sync.ts). Read by
    // resolveTaskOwnerEmail as harder evidence than the raw Dev Owner/Assignee
    // fields, since this is confirmed by a real PR rather than just a Jira
    // field that can go stale after a handoff. Null when no PR matched.
    creditedEmail: text("credited_email"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("jira_issue_loc_key_quarter_idx").on(t.jiraKey, t.quarterKey),
    index("jira_issue_loc_quarter_idx").on(t.quarterKey),
  ]
);

// ---------------------------------------------------------------------------
// Loc Sync Jobs — tracks a single loc-sync run (manual trigger only, no
// cron), one quarter at a time. Mirrors github_sync_jobs' shape; rateLimited
// marks a run that stopped early because GitHub's remaining quota dropped
// below the safety floor, so the next manual trigger picks up the rest.
// ---------------------------------------------------------------------------

export const locSyncJobs = pgTable(
  "loc_sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quarterKey: text("quarter_key").notNull(),
    // pending | running | completed | failed
    status: text("status").notNull().default("pending"),
    totalRepos: integer("total_repos"),
    syncedRepos: integer("synced_repos").notNull().default(0),
    prsScanned: integer("prs_scanned").notNull().default(0),
    matchesFound: integer("matches_found").notNull().default(0),
    rateLimited: boolean("rate_limited").notNull().default(false),
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
    index("loc_sync_jobs_status_idx").on(t.status),
    index("loc_sync_jobs_quarter_idx").on(t.quarterKey),
  ]
);

// ---------------------------------------------------------------------------
// Keka Employees — synced mirror of the Keka HR employee directory. One row per
// employee (keyed by Keka's stable GUID). `userId` bridges to an app user by
// work email (resolved_via='email_auto'), mirroring github_accounts. The
// reporting manager is captured by Keka id + email (`manager_keka_id` /
// `manager_email`) so the chain resolves even before the manager's own row is
// processed. `raw` keeps the full Keka payload so new columns can be backfilled
// without re-fetching (Keka's token endpoint is heavily rate-limited).
// ---------------------------------------------------------------------------

export const kekaEmployees = pgTable(
  "keka_employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Keka's stable employee GUID — the natural upsert key.
    kekaEmployeeId: text("keka_employee_id").notNull(),
    employeeNumber: text("employee_number"),
    displayName: text("display_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Work email, lowercased — the bridge to app users and the manager link.
    email: text("email"),
    jobTitle: text("job_title"),
    // Keka has no first-class department field (it lives under `groups`);
    // kept nullable for later backfill from `raw`.
    department: text("department"),
    // Keka enum: 0 = Working, 1 = Relieved.
    employmentStatus: integer("employment_status"),
    employmentStatusLabel: text("employment_status_label"),
    joiningDate: timestamp("joining_date", { withTimezone: true }),
    exitDate: timestamp("exit_date", { withTimezone: true }),
    // Reporting manager — Keka's `reportsTo`. Captured by id + email so the
    // hierarchy resolves regardless of sync order.
    managerKekaId: text("manager_keka_id"),
    managerEmail: text("manager_email"),
    managerName: text("manager_name"),
    // Identity bridge to an app user. null = unresolved.
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    // How userId was set: 'email_auto' | 'manual'. null while unresolved.
    resolvedVia: text("resolved_via"),
    // Full Keka EmployeeProfile payload — safety net for backfills.
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("keka_employees_keka_id_idx").on(t.kekaEmployeeId),
    index("keka_employees_email_idx").on(t.email),
    index("keka_employees_user_idx").on(t.userId),
    index("keka_employees_manager_idx").on(t.managerKekaId),
  ]
);

// ---------------------------------------------------------------------------
// Keka Attendance — synced daily attendance from Keka's /time/attendance API.
// One row per (employee, date). The attendance API keys on `employeeNumber`
// (NOT the GUID the directory uses), so the number is the natural key and the
// GUID is best-effort resolved at sync time. Deliberately NO foreign key to
// keka_employees: the directory sync hard-prunes relieved staff, and historical
// attendance must survive that. `isAbsent` is a derived convenience flag (no
// clock-in and ~zero effective hours) for fast "who's out" queries; `dayType`
// (Keka's undocumented enum) + `raw` are retained so the heuristic can be
// refined without re-fetching.
// ---------------------------------------------------------------------------

export const kekaAttendance = pgTable(
  "keka_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Keka attendance natural key — the employee number from the API.
    employeeNumber: text("employee_number").notNull(),
    // Best-effort link to the directory GUID (resolved at sync time; null if the
    // employee isn't in the current active directory).
    kekaEmployeeId: text("keka_employee_id"),
    attendanceDate: date("attendance_date").notNull(),
    // Keka's day-type enum, stored raw (undocumented codes) for later decoding.
    dayType: text("day_type"),
    totalGrossHours: doublePrecision("total_gross_hours"),
    totalEffectiveHours: doublePrecision("total_effective_hours"),
    firstIn: timestamp("first_in", { withTimezone: true }),
    lastOut: timestamp("last_out", { withTimezone: true }),
    // Derived: no clock-in and no effective hours → treated as absent / on leave.
    // Heuristic until dayType is decoded; refine here, not at every read site.
    isAbsent: boolean("is_absent").notNull().default(false),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("keka_attendance_emp_date_idx").on(t.employeeNumber, t.attendanceDate),
    index("keka_attendance_date_idx").on(t.attendanceDate),
    index("keka_attendance_keka_id_idx").on(t.kekaEmployeeId),
  ]
);

// ---------------------------------------------------------------------------
// Keka Leave — synced leave requests from Keka's /time/leaverequests API. One
// row per request (which may span multiple dates). This is the AUTHORITATIVE
// "who's on leave" source (approved leave, with type incl. Comp Offs, filed
// ahead of time) — far better than the attendance-gap heuristic. Keyed on the
// request GUID; joins to people on employee_number like attendance. No FK to
// keka_employees (relieved staff are pruned; leave history must survive).
//   status: 0 = pending, 1 = approved, 3 = cancelled/rejected (decoded live).
//   fromSession/toSession: 0 = first half (AM), 1 = second half (PM) — half-days.
//   leaveTypeName/leaveTypeId: the first selection entry, denormalised for
//   querying; `raw` keeps the full selection[] for multi-type requests.
// ---------------------------------------------------------------------------

export const kekaLeave = pgTable(
  "keka_leave",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Keka leave-request GUID — the natural upsert key.
    kekaLeaveId: text("keka_leave_id").notNull(),
    employeeNumber: text("employee_number").notNull(),
    employeeIdentifier: text("employee_identifier"),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    fromSession: integer("from_session"),
    toSession: integer("to_session"),
    status: integer("status"),
    statusLabel: text("status_label"),
    leaveTypeName: text("leave_type_name"),
    leaveTypeId: text("leave_type_id"),
    note: text("note"),
    requestedOn: timestamp("requested_on", { withTimezone: true }),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("keka_leave_id_idx").on(t.kekaLeaveId),
    index("keka_leave_emp_idx").on(t.employeeNumber),
    index("keka_leave_range_idx").on(t.fromDate, t.toDate),
    index("keka_leave_status_idx").on(t.status),
  ]
);

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
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type GithubOrg = typeof githubOrgs.$inferSelect;
export type NewGithubOrg = typeof githubOrgs.$inferInsert;
export type GithubRepo = typeof githubRepos.$inferSelect;
export type NewGithubRepo = typeof githubRepos.$inferInsert;
export type GithubAccount = typeof githubAccounts.$inferSelect;
export type NewGithubAccount = typeof githubAccounts.$inferInsert;
export type GithubContributorStat = typeof githubContributorStats.$inferSelect;
export type NewGithubContributorStat = typeof githubContributorStats.$inferInsert;
export type GithubSyncJob = typeof githubSyncJobs.$inferSelect;
export type KekaEmployee = typeof kekaEmployees.$inferSelect;
export type NewKekaEmployee = typeof kekaEmployees.$inferInsert;
export type KekaAttendance = typeof kekaAttendance.$inferSelect;
export type NewKekaAttendance = typeof kekaAttendance.$inferInsert;
export type KekaLeave = typeof kekaLeave.$inferSelect;
export type NewKekaLeave = typeof kekaLeave.$inferInsert;

// ---------------------------------------------------------------------------
// Release Notes — admin-authored "What's New" entries surfaced via the bell
// ---------------------------------------------------------------------------

export const releaseNotes = pgTable(
  "release_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown
    type: releaseNoteTypeEnum("type").notNull().default("INFO"),
    // Optional call-to-action link (e.g. to the page the note is about).
    linkLabel: text("link_label"),
    linkHref: text("link_href"),
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Null for system-seeded notes.
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("release_notes_published_idx").on(t.isPublished, t.publishedAt)]
);

export type ReleaseNote = typeof releaseNotes.$inferSelect;
export type NewReleaseNote = typeof releaseNotes.$inferInsert;

// Per-user record of which release notes a user has seen. One row = the user
// has acknowledged that note (read it in the bell or dismissed its alert
// modal). Drives the unread badge and stops alerts re-popping across devices.
export const releaseNoteReads = pgTable(
  "release_note_reads",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => releaseNotes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.userId] }),
    index("release_note_reads_user_idx").on(t.userId),
  ]
);

export type ReleaseNoteRead = typeof releaseNoteReads.$inferSelect;
export type NewReleaseNoteRead = typeof releaseNoteReads.$inferInsert;

// ---------------------------------------------------------------------------
// Performance Scorecards — per-developer, per-quarter performance-review
// ratings. One row per (user_email, quarter_key), overwritten on each compute
// run. Sub-scores and their raw inputs are stored alongside a full breakdown
// blob so the drill-down renders without recomputation. Superuser-only.
// ---------------------------------------------------------------------------

export const performanceScorecards = pgTable(
  "performance_scorecards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalized (lower-cased) developer email.
    userEmail: text("user_email").notNull(),
    // Fiscal quarter key, e.g. "2026-Q2".
    quarterKey: text("quarter_key").notNull(),
    // Timestamp of the compute run that produced this row.
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Bug Quality (§4.1)
    weightedBugs: doublePrecision("weighted_bugs").notNull().default(0),
    featureCount: integer("feature_count").notNull().default(0),
    // Priority-weighted credit for bugs this developer RESOLVED (Dev Owner →
    // Assignee). Added to the Bug Quality numerator so fixing bugs lifts the
    // score; the weighted-bug penalty above stays with the Issue Owner.
    bugsResolvedWeighted: doublePrecision("bugs_resolved_weighted")
      .notNull()
      .default(0),
    bugQualityPoints: doublePrecision("bug_quality_points"),

    // MTTR (§4.3) — minutes null when no qualifying samples.
    mttrMinutes: doublePrecision("mttr_minutes"),
    mttrPoints: doublePrecision("mttr_points"),

    // Sprint Commitment (§4.5) — points null when no due-dated tasks.
    sprintCommitmentNotDelayed: integer("sprint_commitment_not_delayed")
      .notNull()
      .default(0),
    sprintCommitmentTotal: integer("sprint_commitment_total").notNull().default(0),
    sprintCommitmentPoints: doublePrecision("sprint_commitment_points"),

    // Complex Tasks (§4.4)
    complexTasksCount: integer("complex_tasks_count").notNull().default(0),
    complexTasksPoints: doublePrecision("complex_tasks_points"),

    // AI / Underestimated Tasks (§4.6)
    underestimatedTasksCount: integer("underestimated_tasks_count")
      .notNull()
      .default(0),
    underestimatedTasksPoints: doublePrecision("underestimated_tasks_points"),

    // Weighted sum of sub-scores (§6.2), the original Performance Review
    // Score. Every completed Jira counts, including self-created-and-assigned
    // ones; this is deliberately the unfiltered rating and must stay that way
    // (see build.ts file header). 0-100.
    finalScore: doublePrecision("final_score").notNull().default(0),

    // The 2x2 Jira Complexity Rating grid — {all-Jiras, self-assigned-
    // excluded (NSA)} x {marked complexity, LOC-predicted ("expected")
    // complexity}. Unlike finalScore above, each of these four is ONLY the
    // Complex Tasks metric's own contribution (0-30), not the full four-metric
    // composite — see build.ts file header for why.

    // COMPLEX. (M) — all-Jiras, marked complexity.
    markedComplexityScoreAll: doublePrecision("marked_complexity_score_all")
      .notNull()
      .default(0),

    // COMPLEX. (E) — all-Jiras, LOC-predicted complexity.
    expectedComplexityScoreAll: doublePrecision("expected_complexity_score_all")
      .notNull()
      .default(0),

    // COMPLEX NSA. (M) — self-assigned Jiras (reporter === credited person)
    // excluded entirely at attribution time (build.ts), marked complexity.
    markedComplexityScore: doublePrecision("marked_complexity_score")
      .notNull()
      .default(0),

    // COMPLEX NSA. (E) — same self-assigned exclusion as NSA (M), LOC-
    // predicted complexity instead of marked.
    expectedComplexityScore: doublePrecision("expected_complexity_score")
      .notNull()
      .default(0),

    // SCORE NSA. (E) — unlike the four COMPLEX columns above (Complex Tasks
    // contribution alone, 0-30), this is the full four-metric composite
    // (0-100), same formula as finalScore, but computed over the
    // self-assigned-excluded population with Complex Tasks weighted by
    // LOC-predicted complexity instead of marked. Directly comparable to
    // finalScore, not to the COMPLEX columns.
    scoreNsaExpected: doublePrecision("score_nsa_expected").notNull().default(0),

    // Complexity Accuracy, all-Jiras: of every task (checked), how many had
    // marked complexity equal to what the LOC predicts (correct) — e.g.
    // correct=9, checked=30 renders as "9/30 (30%)". Shown in the Details
    // drill-down, not the leaderboard. Re-derived fresh on every recompute.
    complexityAccuracyAllCorrect: integer("complexity_accuracy_all_correct")
      .notNull()
      .default(0),
    complexityAccuracyAllChecked: integer("complexity_accuracy_all_checked")
      .notNull()
      .default(0),

    // Complexity Accuracy, NSA — the same tally restricted to the
    // non-self-assigned population (the two COMPLEX NSA. columns above).
    complexityAccuracyCorrect: integer("complexity_accuracy_correct")
      .notNull()
      .default(0),
    complexityAccuracyChecked: integer("complexity_accuracy_checked")
      .notNull()
      .default(0),

    // Full §6.4-style contribution breakdown (per-metric raw → points → weight
    // → contribution) plus display metadata, for the drill-down view.
    breakdown: jsonb("breakdown").$type<Record<string, unknown>>().default({}),
  },
  (t) => [
    uniqueIndex("performance_scorecards_user_quarter_idx").on(
      t.userEmail,
      t.quarterKey
    ),
    index("performance_scorecards_quarter_idx").on(t.quarterKey),
    index("performance_scorecards_quarter_score_idx").on(
      t.quarterKey,
      t.finalScore
    ),
  ]
);

export type PerformanceScorecard = typeof performanceScorecards.$inferSelect;
export type NewPerformanceScorecard = typeof performanceScorecards.$inferInsert;

// ---------------------------------------------------------------------------
// Jira Self-Assigned Overrides — a superuser's manual correction of whether a
// specific Jira counts as self-assigned (reporter === credited person) for
// scoring purposes. Keyed by jiraKey alone (not per-quarter): a Jira is the
// same issue regardless of which quarter it's scored in, so one override
// applies everywhere that key is ever encountered. Persists across
// Recompute — build.ts checks this table before falling back to the computed
// reporter === credited-person comparison (isSelfAssigned).
// ---------------------------------------------------------------------------

export const jiraSelfAssignedOverrides = pgTable("jira_self_assigned_overrides", {
  jiraKey: text("jira_key").primaryKey(), // upper-cased, e.g. "CAV-2245"
  // true = force this Jira to count as self-assigned regardless of what
  // reporter/credited-person actually says; false = force it to NOT count as
  // self-assigned.
  selfAssigned: boolean("self_assigned").notNull(),
  note: text("note"),
  setBy: text("set_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type JiraSelfAssignedOverride = typeof jiraSelfAssignedOverrides.$inferSelect;
export type NewJiraSelfAssignedOverride = typeof jiraSelfAssignedOverrides.$inferInsert;

// ---------------------------------------------------------------------------
// Delay Logs — recorded reasons for why a task/bug is delayed. An issue can
// accrue many editable entries over its lifetime, one per delay event, rather
// than a single open/resolve flag. `linkedProjectId`/
// `linkedIssueId` are set only for the two "other project" categories, where
// the delay is attributed to a task/bug in a different project.
// ---------------------------------------------------------------------------

export const delayReasonCategoryEnum = pgEnum("delay_reason_category", DELAY_CATEGORY_VALUES);

export const delayLogs = pgTable(
  "delay_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => jiraIssues.id, { onDelete: "cascade" }),
    // Denormalized for fast project-wise analytics without joining through the issue.
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    category: delayReasonCategoryEnum("category").notNull(),
    delayDate: date("delay_date").notNull(),
    // Person responsible for this specific delay — defaults to the issue's
    // resolved owner in the UI, but editable per entry, so it's captured here
    // (not just derived from the issue) to preserve history if ownership changes.
    responsibleEmail: text("responsible_email"),
    responsibleName: text("responsible_name"),
    note: text("note"),
    // Set only when category is 'other_project_task' / 'other_project_bug'.
    linkedProjectId: uuid("linked_project_id").references(() => jiraProjects.id, {
      onDelete: "set null",
    }),
    linkedIssueId: uuid("linked_issue_id").references(() => jiraIssues.id, {
      onDelete: "set null",
    }),
    loggedBy: text("logged_by")
      .notNull()
      .references(() => users.id),
    loggedByName: text("logged_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete: NULL = active. Deleting an entry never destroys the row
    // (and with it logged_by/logged_by_name) — it just deactivates it and
    // records who did that and when.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => users.id),
    deletedByName: text("deleted_by_name"),
  },
  (t) => [
    index("delay_logs_issue_idx").on(t.issueId),
    index("delay_logs_project_idx").on(t.projectId),
    index("delay_logs_responsible_idx").on(t.responsibleEmail),
    index("delay_logs_category_idx").on(t.category),
    index("delay_logs_active_idx").on(t.deletedAt),
  ]
);

export type DelayLog = typeof delayLogs.$inferSelect;
export type NewDelayLog = typeof delayLogs.$inferInsert;
export type DelayReasonCategory = (typeof delayReasonCategoryEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Deliveries — a named batch of Jira tasks/bugs committed to ship by one
// target date. The same issue can belong to several deliveries at once (no
// uniqueness on issueId alone, only on (deliveryId, issueId)) — when that
// happens, every surface that shows the issue resolves to whichever
// delivery is nearest (soonest upcoming, else most recently overdue).
// ---------------------------------------------------------------------------

export const deliveryStatusEnum = pgEnum("delivery_status", DELIVERY_STATUS_VALUES);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => jiraProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    deliveryDate: date("delivery_date").notNull(),
    // How many days before deliveryDate the reminder banner starts showing
    // to responsible people / item assignees.
    notifyDaysBefore: integer("notify_days_before").notNull().default(5),
    // Parallel arrays (same idiom as jiraIssues.additionalAssigneeEmails) —
    // `users` has no display-name column, and the banner/UI need a name to
    // show without an extra join per delivery.
    responsibleEmails: text("responsible_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    responsibleNames: text("responsible_names")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete: NULL = active. Matches delayLogs' pattern — deletion never
    // destroys history a banner/analytics query might still reference.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => users.id),
    deletedByName: text("deleted_by_name"),
    // Marked complete once every item in the delivery is "delivered" — the
    // server gate lives in the PATCH route, not here. Distinct from
    // deletedAt: a completed delivery is a success, not a removal, and stays
    // fully counted in history/exports; it just default-hides from the
    // active list (a "Show completed" toggle reveals it) the way a done
    // checklist collapses rather than disappears.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by").references(() => users.id),
    completedByName: text("completed_by_name"),
  },
  (t) => [
    index("deliveries_project_idx").on(t.projectId),
    index("deliveries_date_idx").on(t.deliveryDate),
    index("deliveries_active_idx").on(t.deletedAt),
    index("deliveries_completed_idx").on(t.completedAt),
    index("deliveries_responsible_emails_gin_idx").using("gin", t.responsibleEmails),
  ]
);

export const deliveryItems = pgTable(
  "delivery_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => jiraIssues.id, { onDelete: "cascade" }),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id),
    addedByName: text("added_by_name"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    statusComment: text("status_comment"),
    // Null until the first status change — "who marked this, and when."
    // Deliberately current-state only (no append-only history table), same
    // simplicity tradeoff as removal being a hard delete below.
    statusSetBy: text("status_set_by").references(() => users.id),
    statusSetByName: text("status_set_by_name"),
    statusSetAt: timestamp("status_set_at", { withTimezone: true }),
  },
  (t) => [
    // Only (deliveryId, issueId) is unique — an issue can be a member of
    // many different deliveries at once, just not the same one twice.
    uniqueIndex("delivery_items_delivery_issue_idx").on(t.deliveryId, t.issueId),
    index("delivery_items_delivery_idx").on(t.deliveryId),
    index("delivery_items_issue_idx").on(t.issueId),
    index("delivery_items_status_idx").on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// Delivery Transfers — permanent record of every time an item was migrated
// from one delivery to another. Unlike delivery_items itself (deliberately
// current-state only, see its comment above), a transfer is an event, not
// ongoing state, so it's never edited or soft-deleted once written — the
// append-only audit trail delivery_items intentionally doesn't keep for its
// own status changes.
// ---------------------------------------------------------------------------

export const deliveryTransfers = pgTable(
  "delivery_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => jiraIssues.id, { onDelete: "cascade" }),
    // The delivery_items row this transfer created in the target delivery.
    // Set null (not cascade) on delete: if that row is later removed or
    // migrated again, the fact "X moved this from A to B on this date" is
    // still true and still worth showing.
    newItemId: uuid("new_item_id").references(() => deliveryItems.id, { onDelete: "set null" }),
    // Denormalized name+date on both sides (same idiom as responsibleNames/
    // completedByName above) — history stays readable even if a delivery is
    // later renamed. FK is set null, not cascade: a transfer record must
    // never be destroyed by anything happening to the delivery it references.
    fromDeliveryId: uuid("from_delivery_id").references(() => deliveries.id, { onDelete: "set null" }),
    fromDeliveryName: text("from_delivery_name").notNull(),
    fromDeliveryDate: date("from_delivery_date").notNull(),
    toDeliveryId: uuid("to_delivery_id").references(() => deliveries.id, { onDelete: "set null" }),
    toDeliveryName: text("to_delivery_name").notNull(),
    toDeliveryDate: date("to_delivery_date").notNull(),
    movedBy: text("moved_by")
      .notNull()
      .references(() => users.id),
    movedByName: text("moved_by_name"),
    movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("delivery_transfers_issue_idx").on(t.issueId),
    index("delivery_transfers_issue_moved_at_idx").on(t.issueId, t.movedAt),
  ]
);

export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
export type DeliveryItem = typeof deliveryItems.$inferSelect;
export type NewDeliveryItem = typeof deliveryItems.$inferInsert;
export type DeliveryStatus = (typeof deliveryStatusEnum.enumValues)[number];
export type DeliveryTransfer = typeof deliveryTransfers.$inferSelect;
export type NewDeliveryTransfer = typeof deliveryTransfers.$inferInsert;
