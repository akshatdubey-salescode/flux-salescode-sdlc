ALTER TABLE "support_report_settings" ALTER COLUMN "support_label" SET DEFAULT 'external';--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "raised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rca_shared" boolean DEFAULT false NOT NULL;