CREATE TABLE "jira_self_assigned_overrides" (
	"jira_key" text PRIMARY KEY NOT NULL,
	"self_assigned" boolean NOT NULL,
	"note" text,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jira_self_assigned_overrides" ADD CONSTRAINT "jira_self_assigned_overrides_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;