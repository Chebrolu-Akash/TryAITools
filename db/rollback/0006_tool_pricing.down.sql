-- Rollback for migrations/0006_tool_pricing.sql: removes the pricing_model column (tools themselves are kept).
-- PREVIEW database only. Take `wrangler d1 export` first. Must run BEFORE 0005_blog_cover.down.sql.
ALTER TABLE tools DROP COLUMN pricing_model;
DELETE FROM d1_migrations WHERE name = '0006_tool_pricing.sql';
