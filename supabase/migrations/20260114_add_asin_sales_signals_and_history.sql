-- ASIN Sales Signals (Global cache + learning foundation)
-- Source of truth: global per (asin, marketplace) with 24h TTL via expires_at
-- Also writes daily snapshots to history for future curve training.

CREATE TABLE IF NOT EXISTS asin_sales_signals (
  asin TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',

  -- timestamps
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  -- source + raw fields
  source TEXT NOT NULL, -- e.g. 'rainforest_product'
  bsr INTEGER,
  top_category TEXT, -- main/top category label if available
  bought_last_month_raw JSONB, -- raw bought_last_month field as returned
  price NUMERIC(10, 2),
  rating NUMERIC(3, 2),
  ratings_total INTEGER,

  -- computed fields (best-available signal)
  computed_monthly_units INTEGER,
  computed_monthly_revenue NUMERIC(12, 2),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  signals_used JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- optional: integrity
  raw_payload_hash TEXT,

  PRIMARY KEY (asin, marketplace)
);

CREATE INDEX IF NOT EXISTS idx_asin_sales_signals_expires
  ON asin_sales_signals(expires_at);

CREATE INDEX IF NOT EXISTS idx_asin_sales_signals_fetched
  ON asin_sales_signals(fetched_at);

-- History table (daily snapshots)
CREATE TABLE IF NOT EXISTS asin_sales_signals_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',
  snapshot_date DATE NOT NULL DEFAULT (CURRENT_DATE),

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  bsr INTEGER,
  top_category TEXT,
  bought_last_month_raw JSONB,
  price NUMERIC(10, 2),
  rating NUMERIC(3, 2),
  ratings_total INTEGER,
  computed_monthly_units INTEGER,
  computed_monthly_revenue NUMERIC(12, 2),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  signals_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_payload_hash TEXT,

  -- optional provenance
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  analysis_run_id UUID NULL REFERENCES analysis_runs(id) ON DELETE SET NULL,

  UNIQUE (asin, marketplace, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_asin_sales_signals_history_asin_date
  ON asin_sales_signals_history(asin, marketplace, snapshot_date);

-- RLS
ALTER TABLE asin_sales_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_sales_signals_history ENABLE ROW LEVEL SECURITY;

-- Allow authenticated read (global shared signals)
CREATE POLICY "Allow authenticated read (asin_sales_signals)"
  ON asin_sales_signals
  FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated read (asin_sales_signals_history)"
  ON asin_sales_signals_history
  FOR SELECT
  USING (true);

-- Allow authenticated write (API routes run as authenticated users)
CREATE POLICY "Allow authenticated insert (asin_sales_signals)"
  ON asin_sales_signals
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update (asin_sales_signals)"
  ON asin_sales_signals
  FOR UPDATE
  USING (true);

CREATE POLICY "Allow authenticated insert (asin_sales_signals_history)"
  ON asin_sales_signals_history
  FOR INSERT
  WITH CHECK (true);


