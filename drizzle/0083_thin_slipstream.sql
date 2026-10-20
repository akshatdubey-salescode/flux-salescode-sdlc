CREATE TYPE "public"."tc_category" AS ENUM('functional', 'integration', 'regression', 'ui', 'api', 'security', 'boundary', 'validation', 'data_validation', 'non_functional', 'other', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."tc_file_kind" AS ENUM('testcases', 'signoff_dev', 'signoff_tester', 'llm_feedback', 'reviewer_feedback');--> statement-breakpoint
CREATE TYPE "public"."tc_polarity" AS ENUM('positive', 'negative', 'edge');--> statement-breakpoint
CREATE TYPE "public"."tc_priority" AS ENUM('P1', 'P2', 'P3', 'P4');--> statement-breakpoint
CREATE TYPE "public"."tc_reviewer_state" AS ENUM('pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."tc_round_status" AS ENUM('in_review', 'changes_requested', 'approved');--> statement-breakpoint
CREATE TYPE "public"."tc_severity" AS ENUM('critical', 'high', 'major', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."tc_source" AS ENUM('google_sheet', 'xlsx');--> statement-breakpoint
CREATE TABLE "tc_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"tc_code" text NOT NULL,
	"tc_key" text NOT NULL,
	"section" text,
	"section_no" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"module" text,
	"polarity" "tc_polarity",
	"category" "tc_category" NOT NULL,
	"severity" "tc_severity",
	"priority" "tc_priority",
	"preconditions" text DEFAULT '' NOT NULL,
	"steps" text DEFAULT '' NOT NULL,
	"expected" text DEFAULT '' NOT NULL,
	"share_with_client" boolean,
	"dev_status" text DEFAULT '' NOT NULL,
	"dev_remarks" text DEFAULT '' NOT NULL,
	"ba_review" text DEFAULT '' NOT NULL,
	"ba_remarks" text DEFAULT '' NOT NULL,
	"tester_status" text DEFAULT '' NOT NULL,
	"tester_remarks" text DEFAULT '' NOT NULL,
	"tester_meta" text DEFAULT '' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"kind" "tc_file_kind" NOT NULL,
	"round_no" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_by_name" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_reviewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"state" "tc_reviewer_state" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"source" "tc_source" NOT NULL,
	"sheet_url" text,
	"spreadsheet_id" text,
	"sheet_tab" text,
	"snapshot_file_id" uuid,
	"notes" text,
	"tc_count" integer NOT NULL,
	"status" "tc_round_status" DEFAULT 'in_review' NOT NULL,
	"committed_by" text NOT NULL,
	"committed_by_name" text,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tc_cases" ADD CONSTRAINT "tc_cases_round_id_tc_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."tc_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_files" ADD CONSTRAINT "tc_files_set_id_tc_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tc_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_files" ADD CONSTRAINT "tc_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_reviewers" ADD CONSTRAINT "tc_reviewers_round_id_tc_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."tc_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_rounds" ADD CONSTRAINT "tc_rounds_set_id_tc_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tc_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_rounds" ADD CONSTRAINT "tc_rounds_snapshot_file_id_tc_files_id_fk" FOREIGN KEY ("snapshot_file_id") REFERENCES "public"."tc_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_rounds" ADD CONSTRAINT "tc_rounds_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_sets" ADD CONSTRAINT "tc_sets_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_sets" ADD CONSTRAINT "tc_sets_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_sets" ADD CONSTRAINT "tc_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_cases_round_key_idx" ON "tc_cases" USING btree ("round_id","tc_key");--> statement-breakpoint
CREATE INDEX "tc_cases_round_idx" ON "tc_cases" USING btree ("round_id","row_no");--> statement-breakpoint
CREATE INDEX "tc_files_set_idx" ON "tc_files" USING btree ("set_id","round_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_reviewers_round_email_idx" ON "tc_reviewers" USING btree ("round_id","email");--> statement-breakpoint
CREATE INDEX "tc_reviewers_email_idx" ON "tc_reviewers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_rounds_set_round_idx" ON "tc_rounds" USING btree ("set_id","round_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_sets_issue_idx" ON "tc_sets" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "tc_sets_project_idx" ON "tc_sets" USING btree ("project_id");