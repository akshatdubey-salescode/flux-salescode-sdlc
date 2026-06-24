CREATE TABLE "keka_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keka_employee_id" text NOT NULL,
	"employee_number" text,
	"display_name" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"job_title" text,
	"department" text,
	"employment_status" integer,
	"employment_status_label" text,
	"joining_date" timestamp with time zone,
	"exit_date" timestamp with time zone,
	"manager_keka_id" text,
	"manager_email" text,
	"manager_name" text,
	"user_id" text,
	"resolved_via" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keka_employees" ADD CONSTRAINT "keka_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keka_employees_keka_id_idx" ON "keka_employees" USING btree ("keka_employee_id");--> statement-breakpoint
CREATE INDEX "keka_employees_email_idx" ON "keka_employees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "keka_employees_user_idx" ON "keka_employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "keka_employees_manager_idx" ON "keka_employees" USING btree ("manager_keka_id");