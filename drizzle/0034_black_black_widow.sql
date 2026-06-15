CREATE TABLE "github_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_login" text NOT NULL,
	"github_user_id" integer,
	"display_name" text,
	"avatar_url" text,
	"user_id" text,
	"resolved_via" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_contributor_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"github_login" text NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_repo_id" integer NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"language" text,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"pushed_at" timestamp with time zone,
	"stats_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_repos" integer,
	"synced_repos" integer DEFAULT 0 NOT NULL,
	"stats_rows_upserted" integer DEFAULT 0 NOT NULL,
	"accounts_resolved" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_messages" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_accounts" ADD CONSTRAINT "github_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_contributor_stats" ADD CONSTRAINT "github_contributor_stats_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_accounts_login_idx" ON "github_accounts" USING btree ("github_login");--> statement-breakpoint
CREATE INDEX "github_accounts_user_idx" ON "github_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_contributor_stats_repo_login_week_idx" ON "github_contributor_stats" USING btree ("repo_id","github_login","week_start");--> statement-breakpoint
CREATE INDEX "github_contributor_stats_week_idx" ON "github_contributor_stats" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "github_contributor_stats_login_idx" ON "github_contributor_stats" USING btree ("github_login");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repos_github_repo_id_idx" ON "github_repos" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX "github_repos_tracked_idx" ON "github_repos" USING btree ("is_tracked");--> statement-breakpoint
CREATE INDEX "github_sync_jobs_status_idx" ON "github_sync_jobs" USING btree ("status");