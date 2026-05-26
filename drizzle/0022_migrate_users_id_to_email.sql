-- Migrate users.id from Clerk user ID to email.
-- Drops FK constraints, rewrites all referencing columns to email, then
-- recreates the FK constraints unchanged.

ALTER TABLE "jira_projects" DROP CONSTRAINT "jira_projects_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "sla_rules" DROP CONSTRAINT "sla_rules_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_integrations" DROP CONSTRAINT "user_integrations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "observer_boards" DROP CONSTRAINT "observer_boards_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "feature_requests" DROP CONSTRAINT "feature_requests_submitted_by_users_id_fk";--> statement-breakpoint

UPDATE "jira_projects" c SET "created_by" = u."email" FROM "users" u WHERE c."created_by" = u."id";--> statement-breakpoint
UPDATE "sla_rules" c SET "created_by" = u."email" FROM "users" u WHERE c."created_by" = u."id";--> statement-breakpoint
UPDATE "requirements" c SET "created_by" = u."email" FROM "users" u WHERE c."created_by" = u."id";--> statement-breakpoint
UPDATE "user_integrations" c SET "user_id" = u."email" FROM "users" u WHERE c."user_id" = u."id";--> statement-breakpoint
UPDATE "observer_boards" c SET "created_by" = u."email" FROM "users" u WHERE c."created_by" = u."id";--> statement-breakpoint
UPDATE "feature_requests" c SET "submitted_by" = u."email" FROM "users" u WHERE c."submitted_by" = u."id";--> statement-breakpoint

UPDATE "users" SET "id" = "email" WHERE "id" <> "email";--> statement-breakpoint

ALTER TABLE "jira_projects" ADD CONSTRAINT "jira_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_rules" ADD CONSTRAINT "sla_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer_boards" ADD CONSTRAINT "observer_boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
