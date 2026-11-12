-- 0007_tutorials: AI tutorials for the Learning Hub (/learn/tutorials). Courses and books stay in `courses` (kind);
-- tutorials get their own table because courses.kind is CHECK-constrained and SQLite cannot widen it without
-- rebuilding the table. Additive: one new table, no existing row is touched.
-- A tutorial is either written here (body_md) or links to one elsewhere (resource_url), or both.
-- Rollback: db/rollback/0007_tutorials.down.sql
CREATE TABLE tutorials (
  id                  TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  title               TEXT NOT NULL,
  author_or_provider  TEXT,
  summary             TEXT,
  body_md             TEXT NOT NULL DEFAULT '',
  difficulty          TEXT NOT NULL DEFAULT 'beginner' CHECK (difficulty IN ('beginner','intermediate','advanced')),
  format              TEXT,
  duration            TEXT,
  resource_url        TEXT,
  is_affiliate        INTEGER NOT NULL DEFAULT 0 CHECK (is_affiliate IN (0,1)),
  is_free             INTEGER NOT NULL DEFAULT 1 CHECK (is_free IN (0,1)),
  image_id            TEXT REFERENCES media(id) ON DELETE RESTRICT,
  topics              TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topics)),
  featured            INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  indexing            TEXT NOT NULL DEFAULT 'noindex' CHECK (indexing IN ('index','noindex')),
  seo_title           TEXT,
  seo_description     TEXT,
  published_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX idx_tutorials_list ON tutorials(status, sort_order);
CREATE INDEX idx_tutorials_changed ON tutorials(status, updated_at);
