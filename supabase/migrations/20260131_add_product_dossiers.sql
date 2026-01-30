-- Product dossiers: single Rainforest type=product response per ASIN+domain, TTL 7 days.
-- Used by review insights pipeline (getOrFetchDossier).

CREATE TABLE IF NOT EXISTS product_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL,
  amazon_domain TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_dossiers_asin_domain
  ON product_dossiers (asin, amazon_domain);

CREATE INDEX IF NOT EXISTS idx_product_dossiers_expires_at
  ON product_dossiers (expires_at);

ALTER TABLE product_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read product dossiers"
  ON product_dossiers FOR SELECT USING (true);

CREATE POLICY "Service can manage product dossiers"
  ON product_dossiers FOR ALL USING (true) WITH CHECK (true);
