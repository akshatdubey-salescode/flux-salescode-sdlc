CREATE TABLE "tc_ai_status" (
	"id" text PRIMARY KEY DEFAULT 'minimax' NOT NULL,
	"state" text DEFAULT 'ok' NOT NULL,
	"reason" text,
	"message" text,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
