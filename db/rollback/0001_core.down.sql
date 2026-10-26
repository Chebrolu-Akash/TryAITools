-- Rollback for migrations/0001_core.sql. DESTROYS all CMS data in the target database.
-- Take `wrangler d1 export` first. Never run against production without explicit approval.
DROP TABLE IF EXISTS site_settings;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS tool_redirects;
DROP TABLE IF EXISTS tools;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS meta;
-- Also clear Wrangler's migration bookkeeping so 0001 can be re-applied:
DROP TABLE IF EXISTS d1_migrations;
