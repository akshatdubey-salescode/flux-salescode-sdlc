ALTER TYPE "public"."tc_comment_kind" ADD VALUE 'override';--> statement-breakpoint
ALTER TYPE "public"."tc_reviewer_state" ADD VALUE 're_review';--> statement-breakpoint
ALTER TYPE "public"."tc_reviewer_state" ADD VALUE 'overridden';--> statement-breakpoint
CREATE TABLE "tc_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"jira_key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"deleted_by" text NOT NULL,
	"deleted_by_name" text,
	"round_count" integer DEFAULT 0 NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"signoff_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"storage_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_failures" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tc_cases" ADD COLUMN "sheet_tab" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_review_comments" ADD COLUMN "waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_review_comments" ADD COLUMN "source" text DEFAULT 'reviewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_review_comments" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "tc_reviewers" ADD COLUMN "decided_round_no" integer;--> statement-breakpoint
ALTER TABLE "tc_rounds" ADD COLUMN "sheet_tabs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD COLUMN "feedback_waived" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD COLUMN "change_requests_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_set_stats" ADD COLUMN "overrides_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "tc_deletions_issue_idx" ON "tc_deletions" USING btree ("issue_id","deleted_at");--> statement-breakpoint
-- Backfill for rows created before multi-tab support: each existing round had exactly one tab.
UPDATE "tc_rounds" SET "sheet_tabs" = jsonb_build_array("sheet_tab") WHERE "sheet_tab" IS NOT NULL AND "sheet_tabs" = '[]'::jsonb;--> statement-breakpoint
UPDATE "tc_cases" AS c SET "sheet_tab" = COALESCE(r."sheet_tab", ''), "tc_key" = COALESCE(r."sheet_tab", '') || '::' || c."tc_key" FROM "tc_rounds" AS r WHERE r."id" = c."round_id" AND c."sheet_tab" = '';--> statement-breakpoint
UPDATE "tc_reviewers" AS rv SET "decided_round_no" = r."round_no" FROM "tc_rounds" AS r WHERE r."id" = rv."round_id" AND rv."decided_at" IS NOT NULL AND rv."decided_round_no" IS NULL;
