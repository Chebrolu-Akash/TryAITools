-- 0001_core: core CMS tables. Applied with `wrangler d1 migrations apply` (see db/README.md).
-- Rollback: db/rollback/0001_core.down.sql (kept outside migrations/ so Wrangler never applies it).
-- Timestamps are ISO-8601 UTC text. Foreign keys are enforced by D1.

CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE categories (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  icon            TEXT,
  subcategories   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subcategories)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  indexing        TEXT NOT NULL DEFAULT 'index' CHECK (indexing IN ('index','noindex')),
  seo_title       TEXT,
  seo_description TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tools (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name            TEXT NOT NULL,
  display_name    TEXT,
  url             TEXT,
  category_id     TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  subcategory     TEXT,
  tags            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  logo_url        TEXT,
  tagline         TEXT,
  overview        TEXT,
  best_for        TEXT,
  features        TEXT CHECK (features IS NULL OR json_valid(features)),
  pros            TEXT CHECK (pros IS NULL OR json_valid(pros)),
  limits          TEXT CHECK (limits IS NULL OR json_valid(limits)),
  steps           TEXT CHECK (steps IS NULL OR json_valid(steps)),
  tips            TEXT CHECK (tips IS NULL OR json_valid(tips)),
  pricing_note    TEXT,
  pricing_source  TEXT,
  platforms       TEXT CHECK (platforms IS NULL OR json_valid(platforms)),
  seo_title       TEXT,
  seo_description TEXT,
  canonical_url   TEXT,
  og_image_url    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
  indexing        TEXT NOT NULL DEFAULT 'noindex' CHECK (indexing IN ('index','noindex')),
  needs_review    INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  import_issue    TEXT,
  content_source  TEXT NOT NULL DEFAULT 'admin' CHECK (content_source IN ('import','curated','admin')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tools_category ON tools(category_id, status);
CREATE INDEX idx_tools_status   ON tools(status, updated_at);
CREATE INDEX idx_tools_name     ON tools(name COLLATE NOCASE);
CREATE INDEX idx_tools_review   ON tools(needs_review) WHERE needs_review = 1;

-- Old slugs that must keep working after a slug change (301 to the current slug).
CREATE TABLE tool_redirects (
  old_slug   TEXT PRIMARY KEY CHECK (old_slug GLOB '[a-z0-9]*' AND old_slug NOT GLOB '*[^a-z0-9-]*'),
  tool_id    TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tool_redirects_tool ON tool_redirects(tool_id);

-- Authorized administrators. Intentionally empty after this migration: the first owner is
-- seeded in Stage 3 from a Worker variable. There is no public registration.
CREATE TABLE admin_users (
  email        TEXT PRIMARY KEY CHECK (email = lower(email) AND instr(email,'@') > 1),
  role         TEXT NOT NULL CHECK (role IN ('owner','editor')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT
);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  summary     TEXT
);
CREATE INDEX idx_audit_at ON audit_events(at);

CREATE TABLE site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
