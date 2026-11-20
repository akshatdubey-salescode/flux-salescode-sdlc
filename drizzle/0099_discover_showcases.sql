CREATE TABLE "showcase_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showcase_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showcase_id" uuid,
	"uploader_id" text,
	"storage_key" text NOT NULL,
	"provider_file_id" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_upvotes" (
	"showcase_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_upvotes_showcase_id_user_id_pk" PRIMARY KEY("showcase_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "showcases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"cover_image_id" uuid,
	"repo_url" text,
	"live_url" text,
	"demo_video_url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"taken_down_reason" text,
	"taken_down_by" text,
	"taken_down_at" timestamp with time zone,
	"author_id" text NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(tagline, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C')) STORED
);
--> statement-breakpoint
ALTER TABLE "showcase_comments" ADD CONSTRAINT "showcase_comments_showcase_id_showcases_id_fk" FOREIGN KEY ("showcase_id") REFERENCES "public"."showcases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_comments" ADD CONSTRAINT "showcase_comments_parent_id_showcase_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."showcase_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_comments" ADD CONSTRAINT "showcase_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_images" ADD CONSTRAINT "showcase_images_showcase_id_showcases_id_fk" FOREIGN KEY ("showcase_id") REFERENCES "public"."showcases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_images" ADD CONSTRAINT "showcase_images_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_upvotes" ADD CONSTRAINT "showcase_upvotes_showcase_id_showcases_id_fk" FOREIGN KEY ("showcase_id") REFERENCES "public"."showcases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_upvotes" ADD CONSTRAINT "showcase_upvotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcases" ADD CONSTRAINT "showcases_taken_down_by_users_id_fk" FOREIGN KEY ("taken_down_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcases" ADD CONSTRAINT "showcases_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "showcase_comments_showcase_idx" ON "showcase_comments" USING btree ("showcase_id","created_at");--> statement-breakpoint
CREATE INDEX "showcase_comments_parent_idx" ON "showcase_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "showcase_images_showcase_idx" ON "showcase_images" USING btree ("showcase_id");--> statement-breakpoint
CREATE INDEX "showcase_images_created_idx" ON "showcase_images" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "showcase_upvotes_user_idx" ON "showcase_upvotes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "showcases_short_id_idx" ON "showcases" USING btree ("short_id");--> statement-breakpoint
CREATE INDEX "showcases_author_idx" ON "showcases" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "showcases_status_published_idx" ON "showcases" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "showcases_tags_gin_idx" ON "showcases" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "showcases_search_gin_idx" ON "showcases" USING gin ("search_vector");