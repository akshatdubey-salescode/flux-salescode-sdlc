CREATE TABLE "delivery_movement_comment_edits" (
	"movement_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_id" text NOT NULL,
	"edited_text" text NOT NULL,
	"edited_by" text NOT NULL,
	"edited_by_name" text,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_updated" text,
	CONSTRAINT "delivery_movement_comment_edits_movement_id_comment_id_pk" PRIMARY KEY("movement_id","comment_id"),
	CONSTRAINT "delivery_movement_comment_edits_text_cap" CHECK (char_length("delivery_movement_comment_edits"."edited_text") <= 40000)
);
--> statement-breakpoint
CREATE TABLE "delivery_movement_summaries" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"body" jsonb NOT NULL,
	"note" text,
	"generated_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_hash" text,
	"last_attempt_at" timestamp with time zone,
	"attempts_day" text,
	"attempts_today" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "delivery_movement_summaries_source_check" CHECK ("delivery_movement_summaries"."source" in ('ai', 'rules')),
	CONSTRAINT "delivery_movement_summaries_body_cap" CHECK (pg_column_size("delivery_movement_summaries"."body") < 65536)
);
--> statement-breakpoint
ALTER TABLE "delivery_movements" ADD COLUMN "comment_edits_hash" text;--> statement-breakpoint
ALTER TABLE "delivery_movement_comment_edits" ADD CONSTRAINT "delivery_movement_comment_edits_movement_id_delivery_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."delivery_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_comment_edits" ADD CONSTRAINT "delivery_movement_comment_edits_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_comment_edits" ADD CONSTRAINT "delivery_movement_comment_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_summaries" ADD CONSTRAINT "delivery_movement_summaries_movement_id_delivery_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."delivery_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_summaries" ADD CONSTRAINT "delivery_movement_summaries_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;