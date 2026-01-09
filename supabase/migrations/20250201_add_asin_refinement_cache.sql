-- ASIN Refinement Cache
-- Stores per-user, per-ASIN refined sales data from Rainforest API
-- Scoped to specific analysis runs for reconciliation
-- 24-hour cache expiry

CREATE TABLE IF NOT EXISTS asin_refinement_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  analysis_run_id UUID REFERENCES analysis_runs(id) ON DELETE CASCADE,
  
  -- Refined data from Rainforest
  refined_units_range JSONB NOT NULL, -- { min: number, max: number }
  refined_estimated_revenue NUMERIC(12, 2) NOT NULL,
  current_price NUMERIC(10, 2),
  current_bsr INTEGER,
  review_count INTEGER,
  fulfillment_type TEXT, -- "FBA" | "FBM" | "Amazon"
  
  -- Metadata
  data_source TEXT NOT NULL DEFAULT 'rainforest_refinement',
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  
  -- Unique constraint: one refinement per user per ASIN per analysis run
  UNIQUE(user_id, asin, analysis_run_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_asin_refinement_cache_lookup 
  ON asin_refinement_cache(user_id, asin, analysis_run_id, expires_at);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_asin_refinement_cache_expires 
  ON asin_refinement_cache(expires_at);

-- Auto-cleanup expired entries (can be run via cron)
-- DELETE FROM asin_refinement_cache WHERE expires_at < NOW();

