-- Optional OpenAI-summarized review insights, TTL 30 days.
-- Key: asin + amazon_domain (optional). Payload: star_split, top_complaints, top_praise, summary, source, analyzed_reviews_count.

CREATE TABLE IF NOT EXISTS review_insights_analyzed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL,
  amazon_domain TEXT NOT NULL DEFAULT 'amazon.com',
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_review_insights_analyzed_asin_domain
  ON review_insights_analyzed (asin, amazon_domain);

CREATE INDEX IF NOT EXISTS idx_review_insights_analyzed_expires_at
  ON review_insights_analyzed (expires_at);

ALTER TABLE review_insights_analyzed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read review_insights_analyzed"
  ON review_insights_analyzed FOR SELECT USING (true);

CREATE POLICY "Service can manage review_insights_analyzed"
  ON review_insights_analyzed FOR ALL USING (true) WITH CHECK (true);
