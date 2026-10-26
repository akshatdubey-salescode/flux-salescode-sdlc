CREATE TABLE "tc_ai_project_guidelines" (
	"project_id" uuid NOT NULL,
	"guideline_id" uuid NOT NULL,
	"selected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tc_ai_project_guidelines_project_id_guideline_id_pk" PRIMARY KEY("project_id","guideline_id")
);
--> statement-breakpoint
ALTER TABLE "tc_ai_knowledge_pages" DROP CONSTRAINT "tc_ai_knowledge_pages_project_id_jira_projects_id_fk";
--> statement-breakpoint
DROP INDEX "tc_ai_knowledge_project_page_idx";--> statement-breakpoint
DROP INDEX "tc_ai_knowledge_shared_page_idx";--> statement-breakpoint
ALTER TABLE "tc_ai_project_guidelines" ADD CONSTRAINT "tc_ai_project_guidelines_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tc_ai_project_guidelines" ADD CONSTRAINT "tc_ai_project_guidelines_guideline_id_tc_ai_knowledge_pages_id_fk" FOREIGN KEY ("guideline_id") REFERENCES "public"."tc_ai_knowledge_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_ai_knowledge_page_id_idx" ON "tc_ai_knowledge_pages" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "tc_ai_knowledge_pages" DROP COLUMN "project_id";