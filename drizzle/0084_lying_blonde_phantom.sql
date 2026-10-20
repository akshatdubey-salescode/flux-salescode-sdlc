CREATE TYPE "public"."tc_comment_kind" AS ENUM('comment', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TABLE "tc_review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"case_id" uuid,
	"kind" "tc_comment_kind" DEFAULT 'comment' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"author_email" text NOT NULL,
	"author_name" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tc_review_comments" ADD CONSTRAINT "tc_review_comments_round_id_tc_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."tc_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_review_comments" ADD CONSTRAINT "tc_review_comments_case_id_tc_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."tc_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tc_review_comments_round_idx" ON "tc_review_comments" USING btree ("round_id","created_at");--> statement-breakpoint
CREATE INDEX "tc_review_comments_case_idx" ON "tc_review_comments" USING btree ("case_id");