CREATE TABLE "performance_scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" text NOT NULL,
	"quarter_key" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weighted_bugs" double precision DEFAULT 0 NOT NULL,
	"feature_count" integer DEFAULT 0 NOT NULL,
	"bug_quality_points" double precision,
	"mttr_minutes" double precision,
	"mttr_points" double precision,
	"sprint_commitment_not_delayed" integer DEFAULT 0 NOT NULL,
	"sprint_commitment_total" integer DEFAULT 0 NOT NULL,
	"sprint_commitment_points" double precision,
	"complex_tasks_count" integer DEFAULT 0 NOT NULL,
	"complex_tasks_points" double precision,
	"underestimated_tasks_count" integer DEFAULT 0 NOT NULL,
	"underestimated_tasks_points" double precision,
	"final_score" double precision DEFAULT 0 NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
ALTER TABLE "jira_projects" ADD COLUMN "complexity_field_ids" text[];--> statement-breakpoint
ALTER TABLE "jira_projects" ADD COLUMN "issue_owner_field_ids" text[];--> statement-breakpoint
CREATE UNIQUE INDEX "performance_scorecards_user_quarter_idx" ON "performance_scorecards" USING btree ("user_email","quarter_key");--> statement-breakpoint
CREATE INDEX "performance_scorecards_quarter_idx" ON "performance_scorecards" USING btree ("quarter_key");--> statement-breakpoint
CREATE INDEX "performance_scorecards_quarter_score_idx" ON "performance_scorecards" USING btree ("quarter_key","final_score");