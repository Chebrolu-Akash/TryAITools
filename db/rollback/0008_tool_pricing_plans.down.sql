-- Rollback for migrations/0008_tool_pricing_plans.sql: removes the two columns (tools themselves are kept).
-- PREVIEW database only. Take `wrangler d1 export` first. Must run BEFORE 0007_tutorials.down.sql.
ALTER TABLE tools DROP COLUMN pricing_checked_at;
ALTER TABLE tools DROP COLUMN pricing_plans;
DELETE FROM d1_migrations WHERE name = '0008_tool_pricing_plans.sql';
