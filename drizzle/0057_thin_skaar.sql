CREATE TABLE "github_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"head_ref" text NOT NULL,
	"author_login" text,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"additions" integer,
	"deletions" integer,
	"stats_fetched_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_issue_loc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_key" text NOT NULL,
	"quarter_key" text NOT NULL,
	"total_additions" integer DEFAULT 0 NOT NULL,
	"total_deletions" integer DEFAULT 0 NOT NULL,
	"pr_count" integer DEFAULT 0 NOT NULL,
	"pr_numbers" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loc_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_repos" integer,
	"synced_repos" integer DEFAULT 0 NOT NULL,
	"prs_scanned" integer DEFAULT 0 NOT NULL,
	"matches_found" integer DEFAULT 0 NOT NULL,
	"rate_limited" boolean DEFAULT false NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_messages" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_scorecards" ADD COLUMN "adjusted_final_score" double precision;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_requests_repo_number_idx" ON "github_pull_requests" USING btree ("repo_id","number");--> statement-breakpoint
CREATE INDEX "github_pull_requests_updated_idx" ON "github_pull_requests" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "github_pull_requests_author_idx" ON "github_pull_requests" USING btree ("author_login");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_issue_loc_key_quarter_idx" ON "jira_issue_loc" USING btree ("jira_key","quarter_key");--> statement-breakpoint
CREATE INDEX "jira_issue_loc_quarter_idx" ON "jira_issue_loc" USING btree ("quarter_key");--> statement-breakpoint
CREATE INDEX "loc_sync_jobs_status_idx" ON "loc_sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loc_sync_jobs_quarter_idx" ON "loc_sync_jobs" USING btree ("quarter_key");