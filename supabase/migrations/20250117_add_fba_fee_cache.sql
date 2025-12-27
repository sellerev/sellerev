-- Create fba_fee_cache table for storing detailed FBA fee breakdowns
-- One row per ASIN, overwrites existing row if re-fetched

CREATE TABLE IF NOT EXISTS public.fba_fee_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL UNIQUE,
  fulfillment_fee NUMERIC(10, 2),
  referral_fee NUMERIC(10, 2),
  total_fba_fees NUMERIC(10, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by ASIN
CREATE INDEX IF NOT EXISTS idx_fba_fee_cache_asin
ON public.fba_fee_cache(asin);

-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS idx_fba_fee_cache_fetched_at
ON public.fba_fee_cache(fetched_at);

-- Add comment
COMMENT ON TABLE public.fba_fee_cache IS 'Caches detailed FBA fee breakdowns (fulfillment + referral) from SP-API. One row per ASIN, overwrites on re-fetch.';

-- Enable RLS (Row Level Security)
ALTER TABLE public.fba_fee_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role (backend) full access
CREATE POLICY "Service role can manage fba_fee_cache"
ON public.fba_fee_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Allow authenticated users to read (for potential future use)
CREATE POLICY "Authenticated users can read fba_fee_cache"
ON public.fba_fee_cache
FOR SELECT
TO authenticated
USING (true);





