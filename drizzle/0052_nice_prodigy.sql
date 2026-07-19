ALTER TABLE "delay_logs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD CONSTRAINT "delay_logs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delay_logs_active_idx" ON "delay_logs" USING btree ("deleted_at");