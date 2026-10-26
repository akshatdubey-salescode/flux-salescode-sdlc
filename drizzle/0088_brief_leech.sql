CREATE TABLE "tc_ai_knowledge_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"url" text NOT NULL,
	"page_id" text NOT NULL,
	"title" text NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tc_ai_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"requested_by" text,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"error" text,
	"knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tc_ai_knowledge_pages" ADD CONSTRAINT "tc_ai_knowledge_pages_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_ai_reviews" ADD CONSTRAINT "tc_ai_reviews_round_id_tc_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."tc_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_ai_reviews" ADD CONSTRAINT "tc_ai_reviews_set_id_tc_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tc_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_ai_knowledge_project_page_idx" ON "tc_ai_knowledge_pages" USING btree ("project_id","page_id");--> statement-breakpoint
CREATE INDEX "tc_ai_reviews_round_idx" ON "tc_ai_reviews" USING btree ("round_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_ai_reviews_one_running_idx" ON "tc_ai_reviews" USING btree ("round_id") WHERE "tc_ai_reviews"."status" = 'running';