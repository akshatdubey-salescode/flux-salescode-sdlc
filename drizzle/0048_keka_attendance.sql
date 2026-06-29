CREATE TABLE "keka_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_number" text NOT NULL,
	"keka_employee_id" text,
	"attendance_date" date NOT NULL,
	"day_type" text,
	"total_gross_hours" double precision,
	"total_effective_hours" double precision,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"is_absent" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keka_attendance_emp_date_idx" ON "keka_attendance" USING btree ("employee_number","attendance_date");--> statement-breakpoint
CREATE INDEX "keka_attendance_date_idx" ON "keka_attendance" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "keka_attendance_keka_id_idx" ON "keka_attendance" USING btree ("keka_employee_id");