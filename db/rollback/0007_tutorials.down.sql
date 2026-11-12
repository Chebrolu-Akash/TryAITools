-- Rollback for migrations/0007_tutorials.sql. DESTROYS all tutorial rows (courses and books are not affected).
-- PREVIEW database only. Take `wrangler d1 export` first. Must run BEFORE 0006_tool_pricing.down.sql.
DROP TABLE IF EXISTS tutorials;
DELETE FROM d1_migrations WHERE name = '0007_tutorials.sql';
