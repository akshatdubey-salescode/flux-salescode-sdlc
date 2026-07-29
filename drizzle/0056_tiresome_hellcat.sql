CREATE TABLE "delivery_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"new_item_id" uuid,
	"from_delivery_id" uuid,
	"from_delivery_name" text NOT NULL,
	"from_delivery_date" date NOT NULL,
	"to_delivery_id" uuid,
	"to_delivery_name" text NOT NULL,
	"to_delivery_date" date NOT NULL,
	"moved_by" text NOT NULL,
	"moved_by_name" text,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_transfers" ADD CONSTRAINT "delivery_transfers_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_transfers" ADD CONSTRAINT "delivery_transfers_new_item_id_delivery_items_id_fk" FOREIGN KEY ("new_item_id") REFERENCES "public"."delivery_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_transfers" ADD CONSTRAINT "delivery_transfers_from_delivery_id_deliveries_id_fk" FOREIGN KEY ("from_delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_transfers" ADD CONSTRAINT "delivery_transfers_to_delivery_id_deliveries_id_fk" FOREIGN KEY ("to_delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_transfers" ADD CONSTRAINT "delivery_transfers_moved_by_users_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_transfers_issue_idx" ON "delivery_transfers" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "delivery_transfers_issue_moved_at_idx" ON "delivery_transfers" USING btree ("issue_id","moved_at");