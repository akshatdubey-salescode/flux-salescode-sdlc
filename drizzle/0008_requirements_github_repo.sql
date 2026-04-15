-- Migration: swap requirements.project_id (FK to jira_projects) → github_repo_name text
--> statement-breakpoint
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_project_id_jira_projects_id_fk";
--> statement-breakpoint
DROP INDEX "requirements_project_idx";
--> statement-breakpoint
ALTER TABLE "requirements" DROP COLUMN "project_id";
--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "github_repo_name" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "requirements" ALTER COLUMN "github_repo_name" DROP DEFAULT;
--> statement-breakpoint
CREATE INDEX "requirements_repo_idx" ON "requirements" USING btree ("github_repo_name");
