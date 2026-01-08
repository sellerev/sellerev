-- Add brand field to asin_bsr_cache table for lazy brand enrichment
-- Brand is cached once per ASIN and reused across analyses
-- Defaults to null if brand data is not yet available

ALTER TABLE asin_bsr_cache
ADD COLUMN IF NOT EXISTS brand TEXT;

-- Add index for brand lookups (useful for brand aggregation)
CREATE INDEX IF NOT EXISTS idx_asin_bsr_cache_brand 
ON asin_bsr_cache(brand) 
WHERE brand IS NOT NULL;

