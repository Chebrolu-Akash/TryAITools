-- 0006_tool_pricing: a structured pricing model per tool, set by an admin (Free / Freemium / Free Trial / Paid).
-- Additive: one nullable column, NULL = not recorded (no tag shown, tool listed only under "All"). No data is guessed.
-- Rollback: db/rollback/0006_tool_pricing.down.sql
ALTER TABLE tools ADD COLUMN pricing_model TEXT
  CHECK (pricing_model IS NULL OR pricing_model IN ('free', 'freemium', 'free_trial', 'paid'));
