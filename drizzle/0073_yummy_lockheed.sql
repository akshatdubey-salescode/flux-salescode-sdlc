ALTER TABLE "sprint_items" ADD COLUMN "committed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD COLUMN "removed_by" text;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD COLUMN "removed_by_name" text;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "started_by" text;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "started_by_name" text;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;