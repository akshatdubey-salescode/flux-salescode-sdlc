CREATE TYPE "public"."support_category" AS ENUM('bug', 'understanding', 'data_issue', 'data_upload', 'image_upload', 'others');--> statement-breakpoint
CREATE TYPE "public"."support_owner_side" AS ENUM('salescode', 'client');--> statement-breakpoint
CREATE TYPE "public"."support_report_status" AS ENUM('awaiting_approval', 'sending', 'sent', 'failed', 'lapsed');--> statement-breakpoint
CREATE TABLE "support_report_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"support_label" text DEFAULT 'support' NOT NULL,
	"period_mode" text DEFAULT 'mtd' NOT NULL,
	"period_start" date,
	"to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"approver_user_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"shared_by" text DEFAULT 'L2 Support' NOT NULL,
	"sla" jsonb NOT NULL,
	"work_start" text DEFAULT '10:00' NOT NULL,
	"work_end" text DEFAULT '19:00' NOT NULL,
	"work_days" integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"status" "support_report_status" DEFAULT 'awaiting_approval' NOT NULL,
	"data" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"built_by" text,
	"built_by_name" text,
	"approved_by" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients_to" text[],
	"recipients_cc" text[],
	"provider_message_id" text,
	"error" text,
	"approvers_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support_ticket_ownership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"side" "support_owner_side" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user" text,
	"by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_by_name" text
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "support_category",
	"owner_side" "support_owner_side" DEFAULT 'salescode' NOT NULL,
	"first_responded_at" timestamp with time zone,
	"users_reported" integer,
	"users_impacted" integer,
	"eta" date,
	"updated_by" text,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_issue_id_unique" UNIQUE("issue_id")
);
--> statement-breakpoint
ALTER TABLE "support_report_settings" ADD CONSTRAINT "support_report_settings_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_report_settings" ADD CONSTRAINT "support_report_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_reports" ADD CONSTRAINT "support_reports_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_ownership_events" ADD CONSTRAINT "support_ticket_ownership_events_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_ownership_events" ADD CONSTRAINT "support_ticket_ownership_events_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_ownership_events" ADD CONSTRAINT "support_ticket_ownership_events_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_reports_project_date_idx" ON "support_reports" USING btree ("project_id","report_date");--> statement-breakpoint
CREATE INDEX "support_ticket_ownership_events_issue_idx" ON "support_ticket_ownership_events" USING btree ("issue_id","at");--> statement-breakpoint
CREATE INDEX "support_tickets_project_idx" ON "support_tickets" USING btree ("project_id");