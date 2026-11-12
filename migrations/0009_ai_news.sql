-- 0009_ai_news: the automated AI News section (src/lib/news). Feeds listed in news_sources are collected on a schedule,
-- deduplicated, summarised by AI from the feed's own text and published to /news. Every run is logged.
-- Additive only: four new tables, the seed list of sources and one meta row; no existing table changes.
-- Rollback: db/rollback/0009_ai_news.down.sql

-- Where news comes from. Official RSS/Atom feeds first; outlets only when their robots.txt allows automated access
-- (checked at run time, see src/lib/news/robots.ts). Editable from the admin (enabled, priority); never hard-coded.
CREATE TABLE news_sources (
  id                   TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*'),
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'official' CHECK (kind IN ('official','outlet')),
  feed_url             TEXT NOT NULL UNIQUE CHECK (feed_url LIKE 'https://%'),
  site_url             TEXT NOT NULL CHECK (site_url LIKE 'https://%'),
  default_category     TEXT CHECK (default_category IS NULL OR default_category IN
                         ('model-releases','tool-launches','company-news','research','business-funding','regulation-policy')),
  enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  -- 1: the feed's own images may be shown on cards (official press images). Outlets default to 0 (no hotlinking).
  use_images           INTEGER NOT NULL DEFAULT 0 CHECK (use_images IN (0,1)),
  priority             INTEGER NOT NULL DEFAULT 50,
  max_items            INTEGER NOT NULL DEFAULT 8 CHECK (max_items BETWEEN 1 AND 30),
  robots_status        TEXT NOT NULL DEFAULT 'unknown' CHECK (robots_status IN ('unknown','allowed','disallowed')),
  robots_checked_at    TEXT,
  etag                 TEXT,
  last_modified        TEXT,
  last_fetched_at      TEXT,
  last_success_at      TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_news_sources_due ON news_sources(enabled, last_fetched_at);

-- One row per collected feed item. Duplicates never get a row (unique canonical URL, per-source GUID and normalised
-- headline); a near-duplicate from another source raises coverage_count on the first row instead ("Trending").
-- source_text is the feed's own text, kept only to ground the summary and to retry it; it is never shown publicly.
CREATE TABLE news_articles (
  id                  TEXT PRIMARY KEY,
  slug                TEXT UNIQUE CHECK (slug IS NULL OR (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*')),
  source_id           TEXT NOT NULL REFERENCES news_sources(id) ON DELETE RESTRICT,
  source_name         TEXT NOT NULL,
  canonical_url       TEXT NOT NULL UNIQUE CHECK (canonical_url LIKE 'https://%'),
  guid                TEXT,
  title_key           TEXT NOT NULL UNIQUE,
  original_title      TEXT NOT NULL,
  source_text         TEXT NOT NULL DEFAULT '',
  image_url           TEXT CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  title               TEXT,
  summary             TEXT,
  card_description    TEXT,
  takeaways           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(takeaways)),
  category            TEXT CHECK (category IS NULL OR category IN
                        ('model-releases','tool-launches','company-news','research','business-funding','regulation-policy')),
  tags                TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  companies           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(companies)),
  products            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(products)),
  -- pending: waiting for its summary; published: public; failed: summary failed (retryable); skipped: not enough
  -- source text to summarise honestly; unpublished: hidden by an admin; deleted: removed by an admin (content wiped,
  -- URL/GUID/headline kept as a tombstone so the same item is never collected again).
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed','skipped','unpublished','deleted')),
  featured            INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  coverage_count      INTEGER NOT NULL DEFAULT 1,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  model               TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL DEFAULT 0,
  source_published_at TEXT,
  collected_at        TEXT NOT NULL,
  published_at        TEXT,
  run_id              TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND slug IS NOT NULL AND title IS NOT NULL
         AND summary IS NOT NULL AND card_description IS NOT NULL AND category IS NOT NULL))
);
CREATE UNIQUE INDEX idx_news_articles_guid ON news_articles(source_id, guid) WHERE guid IS NOT NULL;
CREATE INDEX idx_news_articles_list ON news_articles(status, published_at);
CREATE INDEX idx_news_articles_category ON news_articles(status, category, published_at);
CREATE INDEX idx_news_articles_queue ON news_articles(status, collected_at);

-- One row per ingestion run (cron, manual or retry). status 'running' doubles as the lock that keeps two runs from
-- overlapping (a run older than the lock window is considered dead).
CREATE TABLE news_runs (
  id              TEXT PRIMARY KEY,
  trigger         TEXT NOT NULL CHECK (trigger IN ('cron','manual','retry')),
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','partial','failed')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  sources_checked INTEGER NOT NULL DEFAULT 0,
  items_seen      INTEGER NOT NULL DEFAULT 0,
  items_new       INTEGER NOT NULL DEFAULT 0,
  duplicates      INTEGER NOT NULL DEFAULT 0,
  published       INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  model           TEXT,
  error           TEXT,
  details         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details))
);
CREATE INDEX idx_news_runs_started ON news_runs(started_at);
CREATE INDEX idx_news_runs_status ON news_runs(status, started_at);

-- Individual failures of a run (a feed that timed out, an item that failed validation or summarising).
CREATE TABLE news_failures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES news_runs(id) ON DELETE CASCADE,
  source_id   TEXT,
  article_id  TEXT,
  stage       TEXT NOT NULL CHECK (stage IN ('robots','fetch','parse','validate','summarize','save')),
  message     TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX idx_news_failures_run ON news_failures(run_id);
CREATE INDEX idx_news_failures_at ON news_failures(at);

-- The static-site gate serves pre-built /news pages only while this equals the build's value (src/static/freshness.ts).
-- Separate from content_version so a news run does not make the blog and Learning Hub pages re-render.
INSERT INTO meta (key, value) VALUES ('news_version', 'initial');

-- Seed sources (checked 2026-11-01: each feed answered 200 with items). Anthropic and Perplexity publish no public feed
-- (404/403), so they are listed disabled for the record; enable them only once an official feed exists.
-- Four outlets are listed disabled because their robots.txt disallows automated or AI access (the collector re-checks
-- robots.txt anyway and skips a source that disallows it).
INSERT INTO news_sources (id, name, kind, feed_url, site_url, default_category, enabled, use_images, priority, max_items, notes) VALUES
  ('openai', 'OpenAI', 'official', 'https://openai.com/news/rss.xml', 'https://openai.com/news/', NULL, 1, 1, 10, 8, NULL),
  ('google-deepmind', 'Google DeepMind', 'official', 'https://deepmind.google/blog/rss.xml', 'https://deepmind.google/discover/blog/', NULL, 1, 1, 10, 8, NULL),
  ('google-ai', 'Google AI', 'official', 'https://blog.google/technology/ai/rss/', 'https://blog.google/technology/ai/', NULL, 1, 1, 15, 8, NULL),
  ('google-research', 'Google Research', 'official', 'https://research.google/blog/rss/', 'https://research.google/blog/', 'research', 1, 1, 30, 6, NULL),
  ('anthropic', 'Anthropic', 'official', 'https://www.anthropic.com/rss.xml', 'https://www.anthropic.com/news', NULL, 0, 1, 10, 8, 'No public RSS feed (404 on 2026-11-01).'),
  ('microsoft-ai', 'Microsoft (AI news)', 'official', 'https://news.microsoft.com/source/topics/ai/feed/', 'https://news.microsoft.com/source/topics/ai/', NULL, 1, 1, 15, 8, NULL),
  ('microsoft-research', 'Microsoft Research', 'official', 'https://www.microsoft.com/en-us/research/feed/', 'https://www.microsoft.com/en-us/research/blog/', 'research', 1, 1, 30, 6, NULL),
  ('meta-ai', 'Meta AI (Engineering)', 'official', 'https://engineering.fb.com/category/ai-research/feed/', 'https://ai.meta.com/blog/', NULL, 1, 1, 20, 6, 'ai.meta.com has no feed; Meta''s engineering AI-research feed is used.'),
  ('nvidia', 'NVIDIA', 'official', 'https://blogs.nvidia.com/feed/', 'https://blogs.nvidia.com/', NULL, 1, 1, 20, 8, NULL),
  ('nvidia-developer', 'NVIDIA Developer', 'official', 'https://developer.nvidia.com/blog/feed', 'https://developer.nvidia.com/blog/', 'tool-launches', 0, 1, 40, 6, 'Large, very technical feed; enable if wanted.'),
  ('hugging-face', 'Hugging Face', 'official', 'https://huggingface.co/blog/feed.xml', 'https://huggingface.co/blog', NULL, 1, 1, 15, 8, NULL),
  ('perplexity', 'Perplexity', 'official', 'https://www.perplexity.ai/hub/blog/rss.xml', 'https://www.perplexity.ai/hub/blog', NULL, 0, 1, 20, 6, 'No public RSS feed (403/404 on 2026-11-01).'),
  ('aws-ml', 'AWS Machine Learning', 'official', 'https://aws.amazon.com/blogs/machine-learning/feed/', 'https://aws.amazon.com/blogs/machine-learning/', 'tool-launches', 0, 1, 40, 6, 'High volume of tutorials; enable if wanted.'),
  ('ars-technica-ai', 'Ars Technica', 'outlet', 'https://arstechnica.com/ai/feed/', 'https://arstechnica.com/ai/', NULL, 1, 0, 50, 6, NULL),
  ('wired-ai', 'WIRED', 'outlet', 'https://www.wired.com/feed/tag/ai/latest/rss', 'https://www.wired.com/tag/artificial-intelligence/', NULL, 0, 0, 50, 6, 'robots.txt disallows automated or AI access (checked 2026-11-01); re-enable only if that changes.'),
  ('mit-tech-review-ai', 'MIT Technology Review', 'outlet', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'https://www.technologyreview.com/topic/artificial-intelligence/', NULL, 0, 0, 50, 6, 'robots.txt disallows automated or AI access (checked 2026-11-01); re-enable only if that changes.'),
  ('techcrunch-ai', 'TechCrunch', 'outlet', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'https://techcrunch.com/category/artificial-intelligence/', NULL, 0, 0, 50, 6, 'robots.txt disallows automated or AI access (checked 2026-11-01); re-enable only if that changes.'),
  ('the-verge-ai', 'The Verge', 'outlet', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'https://www.theverge.com/ai-artificial-intelligence', NULL, 0, 0, 50, 6, 'robots.txt disallows automated or AI access (checked 2026-11-01); re-enable only if that changes.');
