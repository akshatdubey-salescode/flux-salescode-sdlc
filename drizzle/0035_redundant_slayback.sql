CREATE TABLE "github_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"api_token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_orgs_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "github_orgs" ADD CONSTRAINT "github_orgs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_org_id_github_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."github_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_repos_org_idx" ON "github_repos" USING btree ("org_id");