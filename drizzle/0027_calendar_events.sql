CREATE TABLE IF NOT EXISTS "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"ical_uid" text,
	"summary" text,
	"visibility" text,
	"status" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"organizer_email" text,
	"attendee_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"html_link" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_user_event_idx" ON "calendar_events" ("user_id","google_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_user_starts_idx" ON "calendar_events" ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_ical_uid_idx" ON "calendar_events" ("ical_uid");--> statement-breakpoint
ALTER TABLE "user_integrations" ADD COLUMN IF NOT EXISTS "google_email" text;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD COLUMN IF NOT EXISTS "google_sync_token" text;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD COLUMN IF NOT EXISTS "google_last_synced_at" timestamp with time zone;
