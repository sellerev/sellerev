-- Keyword Snapshots Architecture
-- Precomputed market snapshots for cost-stable scaling

-- Main snapshot table
CREATE TABLE IF NOT EXISTS keyword_snapshots (
  keyword TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'amazon.com',
  total_monthly_units INTEGER NOT NULL,
  total_monthly_revenue DECIMAL(12, 2) NOT NULL,
  average_bsr INTEGER,
  average_price DECIMAL(10, 2),
  product_count INTEGER NOT NULL,
  demand_level TEXT NOT NULL CHECK (demand_level IN ('high', 'medium', 'low', 'very_low')),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refresh_priority INTEGER NOT NULL DEFAULT 5 CHECK (refresh_priority >= 1 AND refresh_priority <= 10),
  search_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (keyword, marketplace)
);

-- Product-level data for each keyword
CREATE TABLE IF NOT EXISTS keyword_products (
  keyword TEXT NOT NULL,
  asin TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 49),
  price DECIMAL(10, 2),
  main_category TEXT,
  main_category_bsr INTEGER,
  estimated_monthly_units INTEGER,
  estimated_monthly_revenue DECIMAL(12, 2),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (keyword, asin)
);

-- Processing queue for background ingestion
CREATE TABLE IF NOT EXISTS keyword_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'amazon.com',
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_last_updated ON keyword_snapshots(last_updated);
CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_priority ON keyword_snapshots(refresh_priority);
CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_search_count ON keyword_snapshots(search_count DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_products_keyword ON keyword_products(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_products_asin ON keyword_products(asin);

CREATE INDEX IF NOT EXISTS idx_keyword_queue_status_priority ON keyword_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_queue_created_at ON keyword_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_keyword_queue_keyword_marketplace ON keyword_queue(keyword, marketplace);

-- Enable RLS
ALTER TABLE keyword_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_queue ENABLE ROW LEVEL SECURITY;

-- Policies: All authenticated users can read snapshots
CREATE POLICY "Allow authenticated read snapshots"
  ON keyword_snapshots
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service write snapshots"
  ON keyword_snapshots
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update snapshots"
  ON keyword_snapshots
  FOR UPDATE
  USING (true);

-- Policies: All authenticated users can read products
CREATE POLICY "Allow authenticated read products"
  ON keyword_products
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service write products"
  ON keyword_products
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update products"
  ON keyword_products
  FOR UPDATE
  USING (true);

CREATE POLICY "Allow service delete products"
  ON keyword_products
  FOR DELETE
  USING (true);

-- Policies: Users can read their own queue items, service can write
CREATE POLICY "Allow authenticated read own queue"
  ON keyword_queue
  FOR SELECT
  USING (auth.uid() = requested_by OR requested_by IS NULL);

CREATE POLICY "Allow authenticated insert queue"
  ON keyword_queue
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update queue"
  ON keyword_queue
  FOR UPDATE
  USING (true);

