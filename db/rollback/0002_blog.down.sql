-- Rollback for migrations/0002_blog.sql. DESTROYS all blog posts in the target database.
-- PREVIEW database only. Take `wrangler d1 export` first. This must run BEFORE 0001_core.down.sql.
-- Only this migration's bookkeeping row is removed so it can be re-applied.
DROP TABLE IF EXISTS blog_posts;
DELETE FROM d1_migrations WHERE name = '0002_blog.sql';
