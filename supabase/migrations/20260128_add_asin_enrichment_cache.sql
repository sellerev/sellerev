-- Global ASIN Enrichment Cache
-- Caches Rainforest enrichment responses (product, reviews, etc.) for 7 days.

CREATE TABLE IF NOT EXISTS asin_enrichment_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL,
  amazon_domain TEXT NOT NULL,
  endpoint TEXT NOT NULL, -- e.g. 'product' | 'reviews' | 'search'
  params_hash TEXT NOT NULL, -- hash/fingerprint of request params that affect the response
  payload JSONB NOT NULL, -- normalized enrichment payload used by the app
  extracted JSONB, -- optional: frequently used derived fields
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  credits_estimated INT NOT NULL DEFAULT 1
);

-- Global unique key for a given enrichment "shape"
CREATE UNIQUE INDEX IF NOT EXISTS uniq_asin_cache_key
ON asin_enrichment_cache (asin, amazon_domain, endpoint, params_hash);

-- Basic TTL index for cleanup
CREATE INDEX IF NOT EXISTS idx_asin_enrichment_cache_expires_at
ON asin_enrichment_cache (expires_at);

-- RLS: public read/write via service role, but table is global (no user_id dimension)
ALTER TABLE asin_enrichment_cache ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can read cached enrichment (it's shared, non-sensitive data)
CREATE POLICY "Anyone can read cached enrichment"
  ON asin_enrichment_cache
  FOR SELECT
  USING (true);

-- Service role (and anon in this project) can manage cache rows
CREATE POLICY "Service role can manage enrichment cache"
  ON asin_enrichment_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

