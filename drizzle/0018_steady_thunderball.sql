CREATE TABLE "freshdesk_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"fd_ticket_id" integer NOT NULL,
	"subject" text NOT NULL,
	"fd_status" integer NOT NULL,
	"fd_status_label" text NOT NULL,
	"fd_priority" integer NOT NULL,
	"fd_priority_label" text NOT NULL,
	"ticket_type" text,
	"requester_name" text,
	"requester_email" text,
	"fd_company_id" text,
	"fd_company_name" text,
	"due_by" timestamp with time zone,
	"fr_due_by" timestamp with time zone,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"fr_escalated" boolean DEFAULT false NOT NULL,
	"linked_jira_issue_id" uuid,
	"linked_jira_key" text,
	"linked_jira_status" text,
	"linked_jira_assignee_name" text,
	"fd_created_at" timestamp with time zone,
	"fd_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freshdesk_tickets" ADD CONSTRAINT "freshdesk_tickets_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freshdesk_tickets" ADD CONSTRAINT "freshdesk_tickets_linked_jira_issue_id_jira_issues_id_fk" FOREIGN KEY ("linked_jira_issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "freshdesk_tickets_project_fd_id_idx" ON "freshdesk_tickets" USING btree ("project_id","fd_ticket_id");--> statement-breakpoint
CREATE INDEX "freshdesk_tickets_project_idx" ON "freshdesk_tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "freshdesk_tickets_status_idx" ON "freshdesk_tickets" USING btree ("fd_status");--> statement-breakpoint
CREATE INDEX "freshdesk_tickets_linked_jira_idx" ON "freshdesk_tickets" USING btree ("linked_jira_issue_id");