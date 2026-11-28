ALTER TABLE "products" ADD COLUMN "attr_viscosity" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attr_volume_ml" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attr_acea" text[];--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attr_oil_type" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attr_approvals" text[];--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_attr_volume_ml_range" CHECK ("products"."attr_volume_ml" BETWEEN 100 AND 220000);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_attr_acea_nonempty" CHECK (cardinality("products"."attr_acea") >= 1);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_attr_approvals_nonempty" CHECK (cardinality("products"."attr_approvals") >= 1);