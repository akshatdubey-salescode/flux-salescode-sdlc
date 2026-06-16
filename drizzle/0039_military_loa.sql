CREATE TABLE "release_note_reads" (
	"note_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_note_reads_note_id_user_id_pk" PRIMARY KEY("note_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "release_note_reads" ADD CONSTRAINT "release_note_reads_note_id_release_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."release_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_note_reads" ADD CONSTRAINT "release_note_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_note_reads_user_idx" ON "release_note_reads" USING btree ("user_id");