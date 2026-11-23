-- 0011_review_history: approval history for tool reviews, so an approval can be reverted exactly and the indexing gate
-- can check who approved what (G9) and whether the category was confirmed (G10). Additive only: one new table and two
-- indexes. No existing row or column is changed.
-- Rollback: db/rollback/0011_review_history.down.sql

-- One row per review decision on a tool.
--   action     'approve' (a draft became the tool's content), 'revert' (an approval was undone)
--   before     JSON: every content, pricing and review field of the tool just before the change (used by revert)
--   after      JSON: the same fields just after the change (revert refuses if the tool no longer holds these values)
--   checklist  JSON: the editor's approval checklist {claims_checked, own_wording, pricing_confirmed,
--              category_confirmed, category_id}
--   draft      JSON: the grounded draft that was approved, including its source text (evidence trail); NULL for revert
--   reverted_at set on an 'approve' row when it is reverted (the row itself is kept)
CREATE TABLE tool_review_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id     TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  at          TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('approve','revert')),
  before      TEXT NOT NULL CHECK (json_valid(before)),
  after       TEXT NOT NULL CHECK (json_valid(after)),
  checklist   TEXT CHECK (checklist IS NULL OR json_valid(checklist)),
  draft       TEXT CHECK (draft IS NULL OR json_valid(draft)),
  reverted_at TEXT
);
CREATE INDEX idx_tool_review_history_tool ON tool_review_history(tool_id, id);
CREATE INDEX idx_tool_review_history_at ON tool_review_history(at);
