CREATE TABLE "observer_board_provision_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"triggered_by" text NOT NULL,
	"source" text DEFAULT 'keka_direct_reports' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"boards_created" integer DEFAULT 0 NOT NULL,
	"members_created" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "observer_boards" ADD COLUMN "provision_run_id" uuid;--> statement-breakpoint
ALTER TABLE "observer_board_provision_runs" ADD CONSTRAINT "observer_board_provision_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer_boards" ADD CONSTRAINT "observer_boards_provision_run_id_observer_board_provision_runs_id_fk" FOREIGN KEY ("provision_run_id") REFERENCES "public"."observer_board_provision_runs"("id") ON DELETE set null ON UPDATE no action;