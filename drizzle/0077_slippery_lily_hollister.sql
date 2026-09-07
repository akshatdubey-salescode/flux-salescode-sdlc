CREATE TABLE "sprint_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_by_name" text
);
--> statement-breakpoint
ALTER TABLE "sprint_notes" ADD CONSTRAINT "sprint_notes_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_notes" ADD CONSTRAINT "sprint_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_notes" ADD CONSTRAINT "sprint_notes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_notes_sprint_idx" ON "sprint_notes" USING btree ("sprint_id","created_at");--> statement-breakpoint
CREATE INDEX "sprint_notes_active_idx" ON "sprint_notes" USING btree ("deleted_at");