CREATE TABLE "google_shared_reader" (
	"id" text PRIMARY KEY DEFAULT 'sheets' NOT NULL,
	"email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"scopes" text DEFAULT '' NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text
);
