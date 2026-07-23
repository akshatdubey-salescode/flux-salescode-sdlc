CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivered', 'partially_delivered', 'not_delivered');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"delivery_date" date NOT NULL,
	"notify_days_before" integer DEFAULT 5 NOT NULL,
	"responsible_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"responsible_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_by_name" text
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"added_by_name" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"status_comment" text,
	"status_set_by" text,
	"status_set_by_name" text,
	"status_set_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_manage_deliveries" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_status_set_by_users_id_fk" FOREIGN KEY ("status_set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_project_idx" ON "deliveries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deliveries_date_idx" ON "deliveries" USING btree ("delivery_date");--> statement-breakpoint
CREATE INDEX "deliveries_active_idx" ON "deliveries" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "deliveries_responsible_emails_gin_idx" ON "deliveries" USING gin ("responsible_emails");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_items_delivery_issue_idx" ON "delivery_items" USING btree ("delivery_id","issue_id");--> statement-breakpoint
CREATE INDEX "delivery_items_delivery_idx" ON "delivery_items" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_items_issue_idx" ON "delivery_items" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "delivery_items_status_idx" ON "delivery_items" USING btree ("status");