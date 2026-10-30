-- 0003_public_indexes: indexes for the public catalogue reads (src/lib/catalog/d1-reader.ts). Indexes only: no data changes.
-- Without them, /tools and category reads scan and sort every tool row (D1 rows-read quota, latency).
-- Rollback: db/rollback/0003_public_indexes.down.sql

-- /tools listing in display order: published, not flagged, ordered by sort_order (LIMIT reads ~one page of rows).
CREATE INDEX idx_tools_public_order ON tools(status, needs_review, sort_order, id);
-- One category's public tools, already in display order (category pages, tool-page alternatives).
CREATE INDEX idx_tools_category_order ON tools(category_id, status, needs_review, sort_order, id);
-- Same-subcategory tools across categories (two subcategory names are shared by two categories each).
CREATE INDEX idx_tools_subcategory ON tools(subcategory);
