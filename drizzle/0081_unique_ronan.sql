ALTER TABLE "jira_projects" ADD COLUMN "qa_assignee_field_ids" text[];--> statement-breakpoint
ALTER TABLE "sla_rules" ADD COLUMN "escalation_multiplier" numeric(10, 2) DEFAULT '2' NOT NULL;