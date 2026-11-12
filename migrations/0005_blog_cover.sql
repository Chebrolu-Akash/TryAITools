-- 0005_blog_cover: optional cover image for blog posts (Phase 2 public blog). Additive: two nullable columns.
-- Rollback: db/rollback/0005_blog_cover.down.sql
ALTER TABLE blog_posts ADD COLUMN cover_image_id TEXT REFERENCES media(id);
ALTER TABLE blog_posts ADD COLUMN cover_alt TEXT;
