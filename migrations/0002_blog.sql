-- 0002_blog: Markdown blog posts managed from the admin CMS (Stage 3).
-- Preview-only for now: it is applied to whichever database the `DB` binding points at (currently
-- tryaitools-preview). The public site does not read this table yet.
-- Rollback: db/rollback/0002_blog.down.sql

CREATE TABLE blog_posts (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  title           TEXT NOT NULL,
  excerpt         TEXT,
  body_md         TEXT NOT NULL DEFAULT '',
  author_name     TEXT,
  tags            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  seo_title       TEXT,
  seo_description TEXT,
  canonical_url   TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX idx_blog_status ON blog_posts(status, published_at);
