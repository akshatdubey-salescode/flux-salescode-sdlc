CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "feature_flags" ("key", "value", "description")
VALUES ('enableRequirementBuilder', 'true'::jsonb, 'Gates the Requirement Builder feature');
