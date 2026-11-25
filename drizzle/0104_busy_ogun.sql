ALTER TABLE "support_report_settings" ADD COLUMN "client_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_report_settings" ADD COLUMN "subject_template" text DEFAULT 'Issue Report — Daily Update | {client} | {date}' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_report_settings" ADD COLUMN "frequency" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_report_settings" ADD COLUMN "weekly_day" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "closed_at" timestamp with time zone;