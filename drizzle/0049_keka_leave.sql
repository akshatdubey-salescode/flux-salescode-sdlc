CREATE TABLE "keka_leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keka_leave_id" text NOT NULL,
	"employee_number" text NOT NULL,
	"employee_identifier" text,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"from_session" integer,
	"to_session" integer,
	"status" integer,
	"status_label" text,
	"leave_type_name" text,
	"leave_type_id" text,
	"note" text,
	"requested_on" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keka_leave_id_idx" ON "keka_leave" USING btree ("keka_leave_id");--> statement-breakpoint
CREATE INDEX "keka_leave_emp_idx" ON "keka_leave" USING btree ("employee_number");--> statement-breakpoint
CREATE INDEX "keka_leave_range_idx" ON "keka_leave" USING btree ("from_date","to_date");--> statement-breakpoint
CREATE INDEX "keka_leave_status_idx" ON "keka_leave" USING btree ("status");