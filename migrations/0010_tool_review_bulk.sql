-- 0010_tool_review_bulk: tool review workflow, shared category memberships, category SEO copy and reversible bulk
-- operations. Additive only: new columns with defaults, three new tables and one data step that records the already
-- reviewed (indexed) tools as reviewed. No existing value is changed except that new column; no row is removed.
-- Rollback: db/rollback/0010_tool_review_bulk.down.sql

-- Review state of a listing. 'reviewed' is required (with the rest of the indexing gate) before a tool may be indexed.
--   unreviewed    imported, nothing verified yet
--   draft_ready   a grounded draft exists in tools.review_draft, waiting for an editor
--   reviewed      content verified and published by an editor
--   needs_manual  automated checks could not verify the product, URL or facts; a person must look
ALTER TABLE tools ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed'
  CHECK (review_status IN ('unreviewed','draft_ready','reviewed','needs_manual'));
ALTER TABLE tools ADD COLUMN reviewed_at TEXT;
-- JSON array of the official pages the content was checked against: [{"url":"https://...","checked_at":"2026-..."}]
ALTER TABLE tools ADD COLUMN review_sources TEXT CHECK (review_sources IS NULL OR json_valid(review_sources));
ALTER TABLE tools ADD COLUMN review_notes TEXT;
-- A grounded draft awaiting approval (never shown publicly): {"tagline":..,"overview":..,"features":[..],...,"quality":{..}}
ALTER TABLE tools ADD COLUMN review_draft TEXT CHECK (review_draft IS NULL OR json_valid(review_draft));
-- Last automated check of the official URL.
ALTER TABLE tools ADD COLUMN url_status TEXT
  CHECK (url_status IS NULL OR url_status IN ('ok','redirect','blocked','dead','error'));
ALTER TABLE tools ADD COLUMN url_checked_at TEXT;
CREATE INDEX idx_tools_review_status ON tools(review_status);

-- The 27 indexed tools were curated and reviewed before this workflow existed.
UPDATE tools SET review_status = 'reviewed', reviewed_at = updated_at WHERE indexing = 'index';

-- Additional category pages a tool appears on (its primary category stays tools.category_id; its URL never changes).
-- Replaces the old practice of copying a product into every category it belongs to.
CREATE TABLE tool_categories (
  tool_id     TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  subcategory TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tool_id, category_id)
);
CREATE INDEX idx_tool_categories_category ON tool_categories(category_id, sort_order);

-- Category landing-page copy (seo_title/seo_description already exist on categories).
ALTER TABLE categories ADD COLUMN intro TEXT;
-- JSON array of {"q": "...", "a": "..."}
ALTER TABLE categories ADD COLUMN faqs TEXT CHECK (faqs IS NULL OR json_valid(faqs));

-- Reversible bulk edits from the admin: one row per operation, one row per changed tool with its before/after values
-- (only the fields that changed), so the whole operation can be undone while nobody has edited those fields since.
CREATE TABLE bulk_operations (
  id          TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  total       INTEGER NOT NULL DEFAULT 0,
  applied     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','undone','partially_undone')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bulk_operations_created ON bulk_operations(created_at);
CREATE TABLE bulk_operation_items (
  op_id      TEXT NOT NULL REFERENCES bulk_operations(id) ON DELETE CASCADE,
  tool_id    TEXT NOT NULL,
  slug       TEXT NOT NULL,
  before     TEXT NOT NULL CHECK (json_valid(before)),
  after      TEXT NOT NULL CHECK (json_valid(after)),
  undone_at  TEXT,
  PRIMARY KEY (op_id, tool_id)
);
