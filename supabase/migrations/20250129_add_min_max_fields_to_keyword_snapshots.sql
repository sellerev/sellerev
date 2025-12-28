-- Add min/max fields to keyword_snapshots for proper Tier-1 estimates
-- These fields ensure the UI always has numeric values (no nulls)

ALTER TABLE keyword_snapshots
ADD COLUMN IF NOT EXISTS est_total_monthly_units_min INTEGER,
ADD COLUMN IF NOT EXISTS est_total_monthly_units_max INTEGER,
ADD COLUMN IF NOT EXISTS est_total_monthly_revenue_min DECIMAL(12, 2),
ADD COLUMN IF NOT EXISTS est_total_monthly_revenue_max DECIMAL(12, 2);

-- Update existing rows to compute min/max from existing total_monthly_units and total_monthly_revenue
-- Use deterministic logic: units_min = total * 0.7, units_max = total * 1.3
-- revenue_min = units_min * avg_price, revenue_max = units_max * avg_price
-- Note: This uses the deterministic logic from the analyze API (150 units per listing)
-- For existing rows, we compute from total_monthly_units as a fallback
UPDATE keyword_snapshots
SET 
  est_total_monthly_units_min = COALESCE(est_total_monthly_units_min, ROUND(total_monthly_units * 0.7)),
  est_total_monthly_units_max = COALESCE(est_total_monthly_units_max, ROUND(total_monthly_units * 1.3)),
  est_total_monthly_revenue_min = COALESCE(
    est_total_monthly_revenue_min, 
    ROUND((ROUND(total_monthly_units * 0.7) * COALESCE(average_price, 25))::numeric, 2)
  ),
  est_total_monthly_revenue_max = COALESCE(
    est_total_monthly_revenue_max, 
    ROUND((ROUND(total_monthly_units * 1.3) * COALESCE(average_price, 25))::numeric, 2)
  )
WHERE est_total_monthly_units_min IS NULL 
   OR est_total_monthly_units_max IS NULL
   OR est_total_monthly_revenue_min IS NULL
   OR est_total_monthly_revenue_max IS NULL;

