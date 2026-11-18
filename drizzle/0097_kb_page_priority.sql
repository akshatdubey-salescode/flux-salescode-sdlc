ALTER TABLE "tc_ai_knowledge_pages" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Keep today's order: general pages first, then oldest first.
UPDATE "tc_ai_knowledge_pages" AS t SET "priority" = s.rn FROM (SELECT "id", (row_number() OVER (ORDER BY "is_general" DESC, "created_at" ASC))::int AS rn FROM "tc_ai_knowledge_pages") AS s WHERE t."id" = s."id";
