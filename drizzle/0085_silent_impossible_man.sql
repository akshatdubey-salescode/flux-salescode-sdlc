CREATE TYPE "public"."tc_result" AS ENUM('pass', 'fail', 'blocked', 'not_run');--> statement-breakpoint
CREATE TYPE "public"."tc_signoff_role" AS ENUM('dev', 'tester');--> statement-breakpoint
CREATE TABLE "tc_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signoff_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"result" "tc_result" NOT NULL,
	"remark" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_set_stats" (
	"set_id" uuid PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"round_status" "tc_round_status" NOT NULL,
	"tc_count" integer NOT NULL,
	"quality" integer NOT NULL,
	"execution_score" integer NOT NULL,
	"confidence" integer NOT NULL,
	"readiness" text NOT NULL,
	"dev_signed" boolean DEFAULT false NOT NULL,
	"tester_signed" boolean DEFAULT false NOT NULL,
	"pass_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"not_run_count" integer DEFAULT 0 NOT NULL,
	"reviewers_total" integer DEFAULT 0 NOT NULL,
	"reviewers_approved" integer DEFAULT 0 NOT NULL,
	"feedback_total" integer DEFAULT 0 NOT NULL,
	"feedback_open" integer DEFAULT 0 NOT NULL,
	"round_count" integer DEFAULT 1 NOT NULL,
	"stats" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"role" "tc_signoff_role" NOT NULL,
	"source" "tc_source" NOT NULL,
	"sheet_url" text,
	"spreadsheet_id" text,
	"sheet_tab" text,
	"file_id" uuid,
	"notes" text,
	"pass_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"not_run_count" integer DEFAULT 0 NOT NULL,
	"meta" text DEFAULT '' NOT NULL,
	"committed_by" text NOT NULL,
	"committed_by_name" text,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tc_results" ADD CONSTRAINT "tc_results_signoff_id_tc_signoffs_id_fk" FOREIGN KEY ("signoff_id") REFERENCES "public"."tc_signoffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_results" ADD CONSTRAINT "tc_results_case_id_tc_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."tc_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD CONSTRAINT "tc_set_stats_set_id_tc_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tc_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD CONSTRAINT "tc_set_stats_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD CONSTRAINT "tc_set_stats_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD CONSTRAINT "tc_set_stats_round_id_tc_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."tc_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_signoffs" ADD CONSTRAINT "tc_signoffs_set_id_tc_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tc_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_signoffs" ADD CONSTRAINT "tc_signoffs_round_id_tc_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."tc_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_signoffs" ADD CONSTRAINT "tc_signoffs_file_id_tc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."tc_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_signoffs" ADD CONSTRAINT "tc_signoffs_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_results_signoff_case_idx" ON "tc_results" USING btree ("signoff_id","case_id");--> statement-breakpoint
CREATE INDEX "tc_results_case_idx" ON "tc_results" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_set_stats_issue_idx" ON "tc_set_stats" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "tc_set_stats_project_idx" ON "tc_set_stats" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tc_signoffs_round_role_idx" ON "tc_signoffs" USING btree ("round_id","role","committed_at");