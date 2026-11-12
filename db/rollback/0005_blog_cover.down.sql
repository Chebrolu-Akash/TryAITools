-- Rollback for migrations/0005_blog_cover.sql: removes the two cover columns (posts themselves are kept).
-- PREVIEW database only. Take `wrangler d1 export` first. Must run BEFORE 0004_content_sections.down.sql.
ALTER TABLE blog_posts DROP COLUMN cover_alt;
ALTER TABLE blog_posts DROP COLUMN cover_image_id;
DELETE FROM d1_migrations WHERE name = '0005_blog_cover.sql';
