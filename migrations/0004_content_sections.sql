-- 0004_content_sections: AI Courses & Books, AI Gadgets, sponsored Guest Articles and uploaded media (Phase 2).
-- Additive only: new tables and one meta row; no existing table changes.
-- Rollback: db/rollback/0004_content_sections.down.sql

-- Images uploaded from the admin. The file itself lives in R2 (binding MEDIA) under r2_key; this row is its metadata.
CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL UNIQUE,
  mime        TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','image/avif')),
  bytes       INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 2097152),
  width       INTEGER,
  height      INTEGER,
  alt         TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Courses AND books (kind).
CREATE TABLE courses (
  id                  TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  kind                TEXT NOT NULL DEFAULT 'course' CHECK (kind IN ('course','book')),
  title               TEXT NOT NULL,
  provider_or_author  TEXT,
  summary             TEXT,
  review_md           TEXT NOT NULL DEFAULT '',
  level               TEXT NOT NULL DEFAULT 'all' CHECK (level IN ('beginner','intermediate','advanced','all')),
  format              TEXT,
  duration            TEXT,
  price_text          TEXT,
  is_free             INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  affiliate_url       TEXT,
  affiliate_network   TEXT,
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
CREATE INDEX idx_courses_list ON courses(status, kind, sort_order);
CREATE INDEX idx_courses_changed ON courses(status, updated_at);

CREATE TABLE gadgets (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  title           TEXT NOT NULL,
  brand           TEXT,
  gadget_type     TEXT NOT NULL DEFAULT 'other' CHECK (gadget_type IN ('smart-speakers','wearables','cameras','translators','home-robots','ai-pcs','other')),
  summary         TEXT,
  features        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(features)),
  review_md       TEXT NOT NULL DEFAULT '',
  price_text      TEXT,
  retailer        TEXT,
  affiliate_url   TEXT,
  alt_retailers   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alt_retailers)),
  image_id        TEXT REFERENCES media(id) ON DELETE RESTRICT,
  featured        INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  indexing        TEXT NOT NULL DEFAULT 'noindex' CHECK (indexing IN ('index','noindex')),
  seo_title       TEXT,
  seo_description TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX idx_gadgets_list ON gadgets(status, gadget_type, sort_order);
CREATE INDEX idx_gadgets_changed ON gadgets(status, updated_at);

-- Paid guest articles. contributor_email, payment_status and payment_ref are private: public queries never select them.
CREATE TABLE guest_articles (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  title            TEXT NOT NULL,
  excerpt          TEXT,
  body_md          TEXT NOT NULL DEFAULT '',
  cover_image_id   TEXT REFERENCES media(id) ON DELETE RESTRICT,
  cover_alt        TEXT,
  topic            TEXT,
  contributor_name TEXT NOT NULL,
  contributor_email TEXT,
  sponsor_name     TEXT NOT NULL,
  sponsor_url      TEXT,
  sponsor_label    TEXT NOT NULL DEFAULT 'Sponsored' CHECK (sponsor_label IN ('Sponsored','Paid partnership','Partner content')),
  payment_status   TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  payment_ref      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
  indexing         TEXT NOT NULL DEFAULT 'index' CHECK (indexing IN ('index','noindex')),
  seo_title        TEXT,
  seo_description  TEXT,
  canonical_url    TEXT,
  published_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND payment_status = 'paid'))
);
CREATE INDEX idx_guest_articles_list ON guest_articles(status, published_at);
CREATE INDEX idx_guest_articles_changed ON guest_articles(status, updated_at);
CREATE INDEX idx_guest_articles_topic ON guest_articles(topic, status);

-- Bumped by every write to these sections and to the blog; the static-site gate compares it with the build.
INSERT INTO meta (key, value) VALUES ('content_version', 'initial') ON CONFLICT(key) DO NOTHING;
