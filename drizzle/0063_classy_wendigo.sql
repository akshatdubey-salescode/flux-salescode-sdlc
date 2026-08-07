ALTER TABLE "performance_scorecards" ADD COLUMN "expected_complexity_score_all" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_scorecards" ADD COLUMN "complexity_accuracy_all_correct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_scorecards" ADD COLUMN "complexity_accuracy_all_checked" integer DEFAULT 0 NOT NULL;