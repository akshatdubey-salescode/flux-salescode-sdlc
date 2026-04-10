CREATE TABLE "email_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sla_violation_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp with time zone,
	"status" text DEFAULT 'sent' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "jira_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"jira_comment_id" text NOT NULL,
	"author_account_id" text,
	"author_email" text,
	"author_name" text,
	"body" text,
	"jira_created_at" timestamp with time zone,
	"jira_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"jira_id" text NOT NULL,
	"jira_key" text NOT NULL,
	"summary" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"status_category" text,
	"issue_type" text NOT NULL,
	"priority" text,
	"assignee_account_id" text,
	"assignee_email" text,
	"assignee_name" text,
	"reporter_account_id" text,
	"reporter_email" text,
	"reporter_name" text,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"jira_created_at" timestamp with time zone,
	"jira_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"jira_base_url" text NOT NULL,
	"jira_project_key" text NOT NULL,
	"jira_email" text NOT NULL,
	"jira_api_token" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by_name" text,
	"changed_by_email" text,
	"duration_seconds" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"condition_field" text NOT NULL,
	"condition_operator" text NOT NULL,
	"condition_value" text NOT NULL,
	"threshold_hours" numeric(10, 2) NOT NULL,
	"notify_assignee" boolean DEFAULT true NOT NULL,
	"notify_reporter" boolean DEFAULT false NOT NULL,
	"additional_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"entered_condition_at" timestamp with time zone NOT NULL,
	"violated_at" timestamp with time zone NOT NULL,
	"threshold_hours_snapshot" numeric(10, 2) NOT NULL,
	"actual_hours" numeric(10, 2) NOT NULL,
	"notification_sent_at" timestamp with time zone,
	"notification_status" text DEFAULT 'pending',
	"resolved_at" timestamp with time zone,
	"resolved_reason" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_notifications" ADD CONSTRAINT "email_notifications_sla_violation_id_sla_violations_id_fk" FOREIGN KEY ("sla_violation_id") REFERENCES "public"."sla_violations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_comments" ADD CONSTRAINT "jira_comments_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_issues" ADD CONSTRAINT "jira_issues_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_projects" ADD CONSTRAINT "jira_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_status_history" ADD CONSTRAINT "jira_status_history_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_rules" ADD CONSTRAINT "sla_rules_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_rules" ADD CONSTRAINT "sla_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_violations" ADD CONSTRAINT "sla_violations_rule_id_sla_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."sla_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_violations" ADD CONSTRAINT "sla_violations_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jira_comments_issue_comment_id_idx" ON "jira_comments" USING btree ("issue_id","jira_comment_id");--> statement-breakpoint
CREATE INDEX "jira_comments_issue_idx" ON "jira_comments" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_issues_project_jira_id_idx" ON "jira_issues" USING btree ("project_id","jira_id");--> statement-breakpoint
CREATE INDEX "jira_issues_jira_key_idx" ON "jira_issues" USING btree ("jira_key");--> statement-breakpoint
CREATE INDEX "jira_issues_status_idx" ON "jira_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jira_issues_assignee_email_idx" ON "jira_issues" USING btree ("assignee_email");--> statement-breakpoint
CREATE INDEX "jira_issues_project_updated_idx" ON "jira_issues" USING btree ("project_id","jira_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_status_history_issue_changed_at_idx" ON "jira_status_history" USING btree ("issue_id","changed_at");--> statement-breakpoint
CREATE INDEX "jira_status_history_issue_idx" ON "jira_status_history" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_violations_active_idx" ON "sla_violations" USING btree ("rule_id","issue_id") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "sla_violations_rule_idx" ON "sla_violations" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "sla_violations_issue_idx" ON "sla_violations" USING btree ("issue_id");