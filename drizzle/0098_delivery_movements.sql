CREATE TYPE "public"."movement_environment" AS ENUM('demo', 'uat', 'prod');--> statement-breakpoint
CREATE TYPE "public"."movement_readiness" AS ENUM('ready', 'blocked', 'override');--> statement-breakpoint
CREATE TYPE "public"."movement_result" AS ENUM('pending', 'moved', 'held');--> statement-breakpoint
CREATE TYPE "public"."movement_slot" AS ENUM('deployer', 'ba', 'lead');--> statement-breakpoint
CREATE TYPE "public"."movement_snapshot_reason" AS ENUM('signoff', 'start', 'done');--> statement-breakpoint
CREATE TYPE "public"."movement_status" AS ENUM('draft', 'ready', 'signed_off', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "delivery_movement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text,
	"actor_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb,
	CONSTRAINT "delivery_movement_events_detail_cap" CHECK (pg_column_size("delivery_movement_events"."detail") < 16384)
);
--> statement-breakpoint
CREATE TABLE "delivery_movement_items" (
	"movement_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"tick_set" boolean DEFAULT false NOT NULL,
	"readiness" "movement_readiness" DEFAULT 'blocked' NOT NULL,
	"override_reason" text,
	"override_by" text,
	"override_by_name" text,
	"override_at" timestamp with time zone,
	"result" "movement_result" DEFAULT 'pending' NOT NULL,
	"result_comment" text,
	"record_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "delivery_movement_items_movement_id_issue_id_pk" PRIMARY KEY("movement_id","issue_id"),
	CONSTRAINT "delivery_movement_items_override_complete" CHECK ("delivery_movement_items"."readiness" <> 'override' OR ("delivery_movement_items"."override_reason" IS NOT NULL AND "delivery_movement_items"."override_by" IS NOT NULL AND "delivery_movement_items"."override_at" IS NOT NULL)),
	CONSTRAINT "delivery_movement_items_warnings_cap" CHECK (jsonb_array_length("delivery_movement_items"."warnings") <= 20),
	CONSTRAINT "delivery_movement_items_record_refs_cap" CHECK (jsonb_array_length("delivery_movement_items"."record_refs") <= 50)
);
--> statement-breakpoint
CREATE TABLE "delivery_movement_signoffs" (
	"movement_id" uuid NOT NULL,
	"slot" "movement_slot" NOT NULL,
	"user_email" text NOT NULL,
	"user_name" text,
	"signed_at" timestamp with time zone,
	"signed_hash" text,
	CONSTRAINT "delivery_movement_signoffs_movement_id_slot_pk" PRIMARY KEY("movement_id","slot")
);
--> statement-breakpoint
CREATE TABLE "delivery_movement_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"reason" "movement_snapshot_reason" NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" text,
	"body" "bytea" NOT NULL,
	CONSTRAINT "delivery_movement_snapshots_body_cap" CHECK (octet_length("delivery_movement_snapshots"."body") <= 1048576)
);
--> statement-breakpoint
CREATE TABLE "delivery_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"environment" "movement_environment" NOT NULL,
	"status" "movement_status" DEFAULT 'draft' NOT NULL,
	"branches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist_hash" text,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"done_by" text,
	"done_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone,
	"last_notified_hash" text,
	"inputs" "bytea",
	"inputs_hash" text,
	"refresh_error" text,
	CONSTRAINT "delivery_movements_branches_cap" CHECK (jsonb_array_length("delivery_movements"."branches") <= 30),
	CONSTRAINT "delivery_movements_refresh_error_cap" CHECK (char_length("delivery_movements"."refresh_error") <= 300),
	CONSTRAINT "delivery_movements_inputs_cap" CHECK (octet_length("delivery_movements"."inputs") <= 4194304)
);
--> statement-breakpoint
ALTER TABLE "delivery_movement_events" ADD CONSTRAINT "delivery_movement_events_movement_id_delivery_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."delivery_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_events" ADD CONSTRAINT "delivery_movement_events_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_items" ADD CONSTRAINT "delivery_movement_items_movement_id_delivery_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."delivery_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_items" ADD CONSTRAINT "delivery_movement_items_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_items" ADD CONSTRAINT "delivery_movement_items_override_by_users_id_fk" FOREIGN KEY ("override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_signoffs" ADD CONSTRAINT "delivery_movement_signoffs_movement_id_delivery_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."delivery_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_snapshots" ADD CONSTRAINT "delivery_movement_snapshots_movement_id_delivery_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."delivery_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movement_snapshots" ADD CONSTRAINT "delivery_movement_snapshots_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movements" ADD CONSTRAINT "delivery_movements_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movements" ADD CONSTRAINT "delivery_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_movements" ADD CONSTRAINT "delivery_movements_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_movement_events_movement_at_idx" ON "delivery_movement_events" USING btree ("movement_id","at");--> statement-breakpoint
CREATE INDEX "delivery_movement_items_issue_idx" ON "delivery_movement_items" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_movement_snapshots_movement_hash_idx" ON "delivery_movement_snapshots" USING btree ("movement_id","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_movements_delivery_env_live_idx" ON "delivery_movements" USING btree ("delivery_id","environment") WHERE "delivery_movements"."status" <> 'cancelled';