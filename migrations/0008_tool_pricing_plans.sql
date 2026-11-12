-- 0008_tool_pricing_plans: detailed pricing for a tool's public page, edited in the admin.
-- pricing_plans: JSON {groups:[{name, plans:[{name, kind, from, prices:[{amount, currency, period, billing}], unit, note}]}]}
--   (see src/lib/pricing-plans.ts). pricing_checked_at: the date the pricing was checked (YYYY-MM-DD).
-- Additive: two nullable columns. NULL = no pricing section shown. pricing_model (the badge) and pricing_source (the
-- official pricing page URL) are reused unchanged.
-- Rollback: db/rollback/0008_tool_pricing_plans.down.sql
ALTER TABLE tools ADD COLUMN pricing_plans TEXT CHECK (pricing_plans IS NULL OR json_valid(pricing_plans));
ALTER TABLE tools ADD COLUMN pricing_checked_at TEXT
  CHECK (pricing_checked_at IS NULL OR pricing_checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
