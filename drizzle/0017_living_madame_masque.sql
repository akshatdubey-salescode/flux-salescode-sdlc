CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"use_case_problem" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_by_email" text NOT NULL,
	"submitted_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_requests_submitted_by_idx" ON "feature_requests" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "feature_requests_priority_idx" ON "feature_requests" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "feature_requests_created_at_idx" ON "feature_requests" USING btree ("created_at");