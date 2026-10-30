-- Rollback for migrations/0003_public_indexes.sql. Drops indexes only; no data is lost.
-- PREVIEW database only. Must run BEFORE 0002_blog.down.sql. Only this migration's bookkeeping row is removed.
DROP INDEX IF EXISTS idx_tools_public_order;
DROP INDEX IF EXISTS idx_tools_category_order;
DROP INDEX IF EXISTS idx_tools_subcategory;
DELETE FROM d1_migrations WHERE name = '0003_public_indexes.sql';
