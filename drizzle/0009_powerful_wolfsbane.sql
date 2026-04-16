CREATE TABLE "user_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"atlassian_account_id" text,
	"atlassian_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "jira_project_id" uuid;--> statement-breakpoint
UPDATE "requirements" SET "jira_project_id" = (SELECT "id" FROM "jira_projects" ORDER BY "created_at" ASC LIMIT 1) WHERE "jira_project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "requirements" ALTER COLUMN "jira_project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_integrations_user_provider_idx" ON "user_integrations" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "user_integrations_user_idx" ON "user_integrations" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_jira_project_id_jira_projects_id_fk" FOREIGN KEY ("jira_project_id") REFERENCES "public"."jira_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirements_project_idx" ON "requirements" USING btree ("jira_project_id");