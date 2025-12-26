-- Add asin_bsr_cache table for BSR caching
-- TTL: 48 hours
-- Purpose: Cache BSR data to avoid repeated product API calls

CREATE TABLE IF NOT EXISTS asin_bsr_cache (
  asin TEXT PRIMARY KEY,
  main_category TEXT,
  main_category_bsr INTEGER,
  price DECIMAL(10,2),
  last_fetched_at TIMESTAMP DEFAULT NOW(),
  source TEXT DEFAULT 'rainforest'
);

-- Index for TTL-based lookups
CREATE INDEX IF NOT EXISTS idx_bsr_last_fetched
ON asin_bsr_cache(last_fetched_at);

-- Enable RLS
ALTER TABLE asin_bsr_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read
CREATE POLICY "Allow authenticated read"
  ON asin_bsr_cache
  FOR SELECT
  USING (true);

-- Policy: Allow service role to write
CREATE POLICY "Allow service write"
  ON asin_bsr_cache
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update"
  ON asin_bsr_cache
  FOR UPDATE
  USING (true);

