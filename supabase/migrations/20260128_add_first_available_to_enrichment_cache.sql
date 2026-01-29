-- Optional: Add queryable columns for first_available (listing age)
-- The dossier payload JSONB already contains these fields, but adding columns
-- allows querying without JSON parsing if needed.

ALTER TABLE asin_enrichment_cache
  ADD COLUMN IF NOT EXISTS first_available_raw TEXT,
  ADD COLUMN IF NOT EXISTS first_available_utc TIMESTAMPTZ;

-- Index for querying by first_available_utc (useful for finding listings by age)
CREATE INDEX IF NOT EXISTS idx_asin_enrichment_cache_first_available_utc
  ON asin_enrichment_cache(first_available_utc)
  WHERE first_available_utc IS NOT NULL;

-- Note: These columns are populated when writing cached dossiers.
-- The payload JSONB remains the source of truth; these columns are for convenience.
