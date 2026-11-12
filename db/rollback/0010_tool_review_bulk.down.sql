-- Rollback for migrations/0010_tool_review_bulk.sql. DESTROYS review state, review drafts, shared category memberships,
-- category intros/FAQs and the bulk-operation history (undo becomes impossible). Tool content and indexing are untouched.
-- PREVIEW database only. Take `wrangler d1 export` first. Run BEFORE 0009_ai_news.down.sql.
-- Note: tools archived as duplicates stay archived and their tool_redirects rows stay; undo those first if wanted.
DROP TABLE IF EXISTS bulk_operation_items;
DROP TABLE IF EXISTS bulk_operations;
DROP TABLE IF EXISTS tool_categories;
DROP INDEX IF EXISTS idx_tools_review_status;
ALTER TABLE categories DROP COLUMN faqs;
ALTER TABLE categories DROP COLUMN intro;
ALTER TABLE tools DROP COLUMN url_checked_at;
ALTER TABLE tools DROP COLUMN url_status;
ALTER TABLE tools DROP COLUMN review_draft;
ALTER TABLE tools DROP COLUMN review_notes;
ALTER TABLE tools DROP COLUMN review_sources;
ALTER TABLE tools DROP COLUMN reviewed_at;
ALTER TABLE tools DROP COLUMN review_status;
DELETE FROM d1_migrations WHERE name = '0010_tool_review_bulk.sql';
