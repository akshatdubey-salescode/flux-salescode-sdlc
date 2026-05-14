CREATE TABLE "engineer_work_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engineer_email" text NOT NULL,
	"jira_issue_id" uuid NOT NULL,
	"declared_date" date NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observer_boards" ADD COLUMN "staleness_threshold_days" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "engineer_work_declarations" ADD CONSTRAINT "engineer_work_declarations_jira_issue_id_jira_issues_id_fk" FOREIGN KEY ("jira_issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engineer_work_declarations_unique_idx" ON "engineer_work_declarations" USING btree ("engineer_email","jira_issue_id","declared_date");--> statement-breakpoint
CREATE INDEX "engineer_work_declarations_email_date_idx" ON "engineer_work_declarations" USING btree ("engineer_email","declared_date");--> statement-breakpoint
CREATE INDEX "engineer_work_declarations_issue_idx" ON "engineer_work_declarations" USING btree ("jira_issue_id");