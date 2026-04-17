CREATE TABLE "observer_board_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"jira_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observer_board_members" ADD CONSTRAINT "observer_board_members_board_id_observer_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."observer_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer_boards" ADD CONSTRAINT "observer_boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "observer_board_members_board_email_idx" ON "observer_board_members" USING btree ("board_id","email");--> statement-breakpoint
CREATE INDEX "observer_board_members_board_idx" ON "observer_board_members" USING btree ("board_id");