-- Create fee_cache table for FBA fee estimation caching
-- Caches SP-API fee estimates to reduce API calls and improve performance

CREATE TABLE IF NOT EXISTS public.fee_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id TEXT NOT NULL DEFAULT 'ATVPDKIKX0DER',
  asin TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  total_fee NUMERIC(10, 2),
  source TEXT NOT NULL CHECK (source IN ('sp_api', 'estimated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Composite unique constraint: same marketplace + ASIN + price = same fee
  UNIQUE(marketplace_id, asin, price)
);

-- Index for fast lookups by marketplace, ASIN, price, and recency
CREATE INDEX IF NOT EXISTS idx_fee_cache_lookup 
ON public.fee_cache(marketplace_id, asin, price, created_at DESC);

-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS idx_fee_cache_created_at 
ON public.fee_cache(created_at);

-- Add comment
COMMENT ON TABLE public.fee_cache IS 'Caches FBA fee estimates from SP-API to reduce API calls. Entries expire after 24 hours.';

-- Enable RLS (Row Level Security)
ALTER TABLE public.fee_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role (backend) full access
CREATE POLICY "Service role can manage fee_cache"
ON public.fee_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Allow authenticated users to read (for potential future use)
-- Fee data is not sensitive - same ASIN + price = same fee for everyone
CREATE POLICY "Authenticated users can read fee_cache"
ON public.fee_cache
FOR SELECT
TO authenticated
USING (true);













