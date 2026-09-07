CREATE TYPE "public"."schedule_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "scheduled_process_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"run_on" date NOT NULL,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"subject" text,
	"detail" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduled_processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process" text NOT NULL,
	"target_id" uuid NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"params" jsonb,
	"frequency" "schedule_frequency" NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"next_run_on" date NOT NULL,
	"ends_on" date,
	"last_run_on" date,
	"paused_at" timestamp with time zone,
	"paused_by" text,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_by_name" text
);
--> statement-breakpoint
ALTER TABLE "scheduled_process_runs" ADD CONSTRAINT "scheduled_process_runs_schedule_id_scheduled_processes_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."scheduled_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_processes" ADD CONSTRAINT "scheduled_processes_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_processes" ADD CONSTRAINT "scheduled_processes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_processes" ADD CONSTRAINT "scheduled_processes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_process_runs_cron_day_idx" ON "scheduled_process_runs" USING btree ("schedule_id","run_on") WHERE "trigger" = 'cron';--> statement-breakpoint
CREATE INDEX "scheduled_process_runs_schedule_idx" ON "scheduled_process_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_processes_due_idx" ON "scheduled_processes" USING btree ("next_run_on") WHERE paused_at IS NULL AND stopped_at IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "scheduled_processes_target_idx" ON "scheduled_processes" USING btree ("process","target_id");--> statement-breakpoint
CREATE INDEX "scheduled_processes_creator_idx" ON "scheduled_processes" USING btree ("created_by");