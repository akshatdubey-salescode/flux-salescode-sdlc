-- Migration: SLA v2 — compound conditions, stakeholders, escalation tier
-- Converts sla_rules to JSONB conditions tree, adds project_stakeholders,
-- adds escalation_notified_at to sla_violations.

--> statement-breakpoint
CREATE TABLE "project_stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_stakeholders_project_email_idx" ON "project_stakeholders" USING btree ("project_id","email");
--> statement-breakpoint
CREATE INDEX "project_stakeholders_project_idx" ON "project_stakeholders" USING btree ("project_id");
--> statement-breakpoint

-- Add conditions column (nullable first so we can populate existing rows)
ALTER TABLE "sla_rules" ADD COLUMN "conditions" jsonb;
--> statement-breakpoint

-- Migrate existing single-condition rows to the new compound structure
UPDATE "sla_rules"
SET "conditions" = jsonb_build_object(
  'operator', 'OR',
  'groups', jsonb_build_array(
    jsonb_build_object(
      'operator', 'AND',
      'conditions', jsonb_build_array(
        jsonb_build_object(
          'field', "condition_field",
          'operator', "condition_operator",
          'value', "condition_value"
        )
      )
    )
  )
);
--> statement-breakpoint

-- Now enforce NOT NULL
ALTER TABLE "sla_rules" ALTER COLUMN "conditions" SET NOT NULL;
--> statement-breakpoint

-- Drop the old flat condition columns
ALTER TABLE "sla_rules" DROP COLUMN "condition_field";
--> statement-breakpoint
ALTER TABLE "sla_rules" DROP COLUMN "condition_operator";
--> statement-breakpoint
ALTER TABLE "sla_rules" DROP COLUMN "condition_value";
--> statement-breakpoint

-- Add escalation tier-2 timestamp to sla_violations
ALTER TABLE "sla_violations" ADD COLUMN "escalation_notified_at" timestamp with time zone;
