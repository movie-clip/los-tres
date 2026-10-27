-- S4.0: retires the seven demo categories of the earlier tree. No editor ever
-- existed, so these slugs can only come from the demo seed. Order matters: the
-- foreign keys restrict, so products and mappings leave first, then the five
-- children, then the two roots. The fixed tree itself is made by
-- ensureFixedCategoryTree at the end of runMigrations, not here.
UPDATE "products" SET "category_id" = NULL WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "slug" IN ('automovil', 'herramientas', 'aceites-y-lubricantes', 'filtros', 'escobillas-y-bombillas', 'herramientas-electricas', 'herramientas-manuales'));--> statement-breakpoint
DELETE FROM "feed_category_mappings" WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "slug" IN ('automovil', 'herramientas', 'aceites-y-lubricantes', 'filtros', 'escobillas-y-bombillas', 'herramientas-electricas', 'herramientas-manuales'));--> statement-breakpoint
DELETE FROM "categories" WHERE "slug" IN ('aceites-y-lubricantes', 'filtros', 'escobillas-y-bombillas', 'herramientas-electricas', 'herramientas-manuales');--> statement-breakpoint
DELETE FROM "categories" WHERE "slug" IN ('automovil', 'herramientas');
