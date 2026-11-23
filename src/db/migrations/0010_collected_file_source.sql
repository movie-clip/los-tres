ALTER TYPE "public"."feed_source_type" ADD VALUE 'collected_file';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_collected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_collected_file_no_network" CHECK ("feeds"."source_type"::text <> 'collected_file' or "feeds"."network_id" is null);--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_collected_file_not_demo" CHECK ("feeds"."source_type"::text <> 'collected_file' or "feeds"."is_demo" = false);