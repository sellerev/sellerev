-- asin_fees_cache: per-user SP-API fees estimate cache (asin + marketplace + price + dims_hash)
-- TTL 7 days. Replaces use of spapi_fee_estimates for user-scoped fees.

CREATE TABLE IF NOT EXISTS public.asin_fees_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin text NOT NULL,
  marketplace_id text NOT NULL,
  is_amazon_fulfilled boolean NOT NULL DEFAULT true,
  listing_price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  dims_hash text NOT NULL DEFAULT '',
  fees_json jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, asin, marketplace_id, is_amazon_fulfilled, listing_price, dims_hash)
);

CREATE INDEX IF NOT EXISTS idx_asin_fees_cache_lookup
  ON public.asin_fees_cache (user_id, asin, marketplace_id, listing_price, dims_hash);

CREATE INDEX IF NOT EXISTS idx_asin_fees_cache_expires_at
  ON public.asin_fees_cache (expires_at);

COMMENT ON TABLE public.asin_fees_cache IS 'Caches SP-API fees estimate per user/(asin, marketplace, price, dims). 7-day TTL.';

ALTER TABLE public.asin_fees_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own asin_fees_cache"
  ON public.asin_fees_cache
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
