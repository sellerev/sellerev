-- Add keyword_analysis_cache table for aggressive caching
-- Cache key: analyze:keyword:${keyword}:${marketplace}
-- TTL: 24 hours

CREATE TABLE IF NOT EXISTS keyword_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_keyword_cache_key ON keyword_analysis_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_keyword_cache_expires ON keyword_analysis_cache(expires_at);

-- Enable RLS
ALTER TABLE keyword_analysis_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own cached data (if we add user_id later)
-- For now, allow all authenticated users to read
CREATE POLICY "Allow authenticated read"
  ON keyword_analysis_cache
  FOR SELECT
  USING (true);

-- Policy: Service role can write (for API routes)
CREATE POLICY "Allow service write"
  ON keyword_analysis_cache
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update"
  ON keyword_analysis_cache
  FOR UPDATE
  USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_keyword_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_keyword_cache_updated_at
  BEFORE UPDATE ON keyword_analysis_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_keyword_cache_updated_at();

-- Cleanup expired entries (can be run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_keyword_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM keyword_analysis_cache
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
