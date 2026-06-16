CREATE TYPE "public"."release_note_type" AS ENUM('INFO', 'ALERT');--> statement-breakpoint
CREATE TABLE "release_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"type" "release_note_type" DEFAULT 'INFO' NOT NULL,
	"link_label" text,
	"link_href" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_notes" ADD CONSTRAINT "release_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_notes_published_idx" ON "release_notes" USING btree ("is_published","published_at");--> statement-breakpoint
INSERT INTO "release_notes" ("id", "title", "body", "type", "link_label", "link_href", "is_published", "published_at") VALUES (
	'00000000-0000-4000-8000-000000000001',
	'You can now customise your sidebar',
	E'The sidebar got a lot lighter. Head to **Settings → Customise Sidebar** to choose exactly which menu items you want to see — move the ones you use into *My Sidebar* and tuck the rest away.\n\nYour choices are saved to this browser and apply instantly. Hidden items are still reachable any time via the ⌘K command palette.',
	'ALERT',
	'Customise your sidebar',
	'/settings/customise-sidebar',
	true,
	now()
);