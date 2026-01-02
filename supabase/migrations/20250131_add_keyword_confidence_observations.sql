-- Keyword Confidence Observations Table (part of market_observations family)
-- Stores observed total units and revenue from each keyword analysis for confidence tracking
-- Note: This is a separate table from the existing market_observations table which has a different structure

CREATE TABLE IF NOT EXISTS keyword_confidence_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  market TEXT NOT NULL,
  observed_total_units NUMERIC NOT NULL,
  observed_total_revenue NUMERIC NOT NULL,
  run_id UUID REFERENCES analysis_runs(id),
  timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_keyword_confidence_observations_keyword_market 
  ON keyword_confidence_observations(keyword, market);
CREATE INDEX IF NOT EXISTS idx_keyword_confidence_observations_timestamp 
  ON keyword_confidence_observations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_confidence_observations_run_id 
  ON keyword_confidence_observations(run_id);

-- Enable RLS
ALTER TABLE keyword_confidence_observations ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can insert/read (for API routes)
CREATE POLICY "Allow service read"
  ON keyword_confidence_observations
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service insert"
  ON keyword_confidence_observations
  FOR INSERT
  WITH CHECK (true);

