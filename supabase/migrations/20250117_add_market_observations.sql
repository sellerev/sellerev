-- Market Observations Table
-- Stores historical observations from every keyword analyze for self-improving estimators

CREATE TABLE IF NOT EXISTS market_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  marketplace TEXT NOT NULL,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  page INT NOT NULL DEFAULT 1,
  listings_json JSONB NOT NULL,
  summary_json JSONB NOT NULL, -- avg_price, avg_reviews, avg_rating, sponsored_pct, etc
  estimator_inputs_json JSONB, -- Features used by estimator
  estimator_outputs_json JSONB, -- Outputs from estimator (search_volume, revenue_estimates, etc)
  rainforest_request_metadata JSONB, -- Request params, response metadata
  data_quality JSONB NOT NULL -- has_listings, counts, missing_fields, etc
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_market_observations_marketplace_keyword 
  ON market_observations(marketplace, normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_market_observations_created_at 
  ON market_observations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_observations_keyword 
  ON market_observations(normalized_keyword);

-- Enable RLS
ALTER TABLE market_observations ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can insert/read (for API routes and training)
CREATE POLICY "Allow service read"
  ON market_observations
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service insert"
  ON market_observations
  FOR INSERT
  WITH CHECK (true);
