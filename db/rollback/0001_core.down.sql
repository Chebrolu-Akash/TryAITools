-- Rollback for migrations/0001_core.sql. DESTROYS all CMS data in the target database.
-- PREVIEW database only. Take `wrangler d1 export` first. Roll back newer migrations (0002 ...) BEFORE this one.
-- Wrangler's bookkeeping table d1_migrations is kept; only this migration's row is removed so it can be re-applied.
DROP TABLE IF EXISTS site_settings;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS tool_redirects;
DROP TABLE IF EXISTS tools;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS meta;
DELETE FROM d1_migrations WHERE name = '0001_core.sql';
