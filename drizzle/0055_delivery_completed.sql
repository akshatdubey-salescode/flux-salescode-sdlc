ALTER TABLE "deliveries" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "completed_by" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "completed_by_name" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_completed_idx" ON "deliveries" USING btree ("completed_at");