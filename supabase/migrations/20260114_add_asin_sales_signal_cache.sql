-- Global ASIN Sales Signal Cache (Learning Foundation)
-- Stores latest sales signals (BSR + bought_last_month + reviews + price) per ASIN.
-- Purpose:
-- 1) Reduce repeated Rainforest calls (fast enrichment, ≤5s on cache hit)
-- 2) Accumulate proprietary dataset over time (Helium10-style foundation)
--
-- TTL concept: enforced in application logic via last_fetched_at cutoffs.

CREATE TABLE IF NOT EXISTS asin_sales_signal_cache (
  asin TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',
  refined_units_range JSONB NOT NULL, -- { min: number, max: number }
  refined_estimated_revenue NUMERIC(12, 2) NOT NULL,
  current_price NUMERIC(10, 2),
  current_bsr INTEGER,
  review_count INTEGER,
  fulfillment_type TEXT, -- "FBA" | "FBM" | "Amazon"
  data_source TEXT NOT NULL DEFAULT 'rainforest_refinement',
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asin, marketplace)
);

-- Index for TTL-based lookups
CREATE INDEX IF NOT EXISTS idx_asin_sales_signal_cache_last_fetched
  ON asin_sales_signal_cache(last_fetched_at);

-- Enable RLS
ALTER TABLE asin_sales_signal_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (signals are not user-private)
CREATE POLICY "Allow authenticated read (asin_sales_signal_cache)"
  ON asin_sales_signal_cache
  FOR SELECT
  USING (true);

-- Allow authenticated users to write (API routes run as authenticated users)
CREATE POLICY "Allow authenticated insert (asin_sales_signal_cache)"
  ON asin_sales_signal_cache
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update (asin_sales_signal_cache)"
  ON asin_sales_signal_cache
  FOR UPDATE
  USING (true);


