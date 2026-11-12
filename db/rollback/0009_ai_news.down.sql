-- Rollback for migrations/0009_ai_news.sql. DESTROYS every news source, article, run and failure row.
-- PREVIEW database only. Take `wrangler d1 export` first. Must run BEFORE 0008_tool_pricing_plans.down.sql.
DROP TABLE IF EXISTS news_failures;
DROP TABLE IF EXISTS news_runs;
DROP TABLE IF EXISTS news_articles;
DROP TABLE IF EXISTS news_sources;
DELETE FROM meta WHERE key = 'news_version';
DELETE FROM d1_migrations WHERE name = '0009_ai_news.sql';
