CREATE TABLE "delivery_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"delivery_id" uuid,
	"delivery_name" text NOT NULL,
	"from_status" "delivery_status",
	"to_status" "delivery_status" NOT NULL,
	"status_comment" text,
	"changed_by" text NOT NULL,
	"changed_by_name" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_status_history_issue_idx" ON "delivery_status_history" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "delivery_status_history_issue_changed_at_idx" ON "delivery_status_history" USING btree ("issue_id","changed_at");--> statement-breakpoint
CREATE INDEX "jira_issues_assignee_email_lower_idx" ON "jira_issues" USING btree (lower("assignee_email"));--> statement-breakpoint
CREATE INDEX "jira_issues_reporter_email_lower_idx" ON "jira_issues" USING btree (lower("reporter_email"));