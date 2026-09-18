CREATE TYPE "public"."delay_recorded_in" AS ENUM('sprint', 'delivery');--> statement-breakpoint
ALTER TABLE "delay_logs" ADD COLUMN "recorded_in" "delay_recorded_in";