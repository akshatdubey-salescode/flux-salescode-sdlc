CREATE TABLE "github_app_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_orgs" ALTER COLUMN "api_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "github_orgs" ADD COLUMN "auth_mode" text DEFAULT 'pat' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_orgs" ADD COLUMN "app_installation_id" text;