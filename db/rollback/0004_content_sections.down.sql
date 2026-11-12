-- Rollback for migrations/0004_content_sections.sql. DESTROYS all courses, gadgets, guest articles and media rows.
-- PREVIEW database only. Take `wrangler d1 export` first (R2 files are not deleted by this script).
-- Runs after 0005_blog_cover.down.sql. Only this migration's bookkeeping row is removed so it can be re-applied.
DROP TABLE IF EXISTS guest_articles;
DROP TABLE IF EXISTS gadgets;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS media;
DELETE FROM meta WHERE key = 'content_version';
DELETE FROM d1_migrations WHERE name = '0004_content_sections.sql';
