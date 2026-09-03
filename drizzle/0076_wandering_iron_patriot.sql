ALTER TABLE "sprints" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_board_id_observer_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."observer_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprints_board_idx" ON "sprints" USING btree ("board_id");