-- Rollback for migrations/0011_review_history.sql. DESTROYS the approval history: approvals can no longer be reverted
-- from the admin, and the indexing gate's G9/G10 checks will fail for every tool approved through the new workflow
-- (already indexed tools keep their indexing). Tool content and indexing are untouched.
-- PREVIEW database only. Take `wrangler d1 export` first. Roll back the Worker to a version without the review-history
-- code first. Run BEFORE 0010_tool_review_bulk.down.sql.
DROP INDEX IF EXISTS idx_tool_review_history_at;
DROP INDEX IF EXISTS idx_tool_review_history_tool;
DROP TABLE IF EXISTS tool_review_history;
DELETE FROM d1_migrations WHERE name = '0011_review_history.sql';
