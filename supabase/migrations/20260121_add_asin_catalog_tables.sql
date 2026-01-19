-- ASIN Catalog Tables
-- Comprehensive normalized storage for SP-API Catalog Items data
-- TTL: 7 days per ASIN
-- Purpose: Store buyer-facing, comparable attributes for AI reasoning

-- ASIN Core - Essential product identification
CREATE TABLE IF NOT EXISTS asin_core (
  asin TEXT PRIMARY KEY,
  title TEXT,
  brand TEXT,
  manufacturer TEXT,
  model_number TEXT,
  product_type TEXT,
  last_enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ASIN Market - Sales performance and positioning
CREATE TABLE IF NOT EXISTS asin_market (
  asin TEXT PRIMARY KEY,
  primary_category TEXT,
  primary_rank INTEGER, -- BSR from primary classification
  root_category TEXT,
  root_rank INTEGER, -- BSR from root category if different
  last_enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ASIN Attributes - Buyer-facing, comparable attributes
CREATE TABLE IF NOT EXISTS asin_attributes (
  asin TEXT PRIMARY KEY,
  bullet_points TEXT[], -- Array of bullet points
  special_features TEXT[], -- Array of special features
  dimensions_length NUMERIC(10,2),
  dimensions_width NUMERIC(10,2),
  dimensions_height NUMERIC(10,2),
  dimensions_unit TEXT,
  weight_value NUMERIC(10,2),
  weight_unit TEXT,
  connectivity TEXT[], -- e.g., ["Bluetooth", "Wi-Fi"]
  resolution TEXT,
  power_consumption TEXT,
  included_components TEXT[],
  color TEXT,
  material TEXT,
  size TEXT,
  last_enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ASIN Media - Images and visual assets
CREATE TABLE IF NOT EXISTS asin_media (
  asin TEXT PRIMARY KEY,
  primary_image_url TEXT,
  additional_images TEXT[], -- Array of image URLs (max 10)
  last_enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ASIN Relationships - Parent/child/variation structure
CREATE TABLE IF NOT EXISTS asin_relationships (
  asin TEXT PRIMARY KEY,
  parent_asin TEXT, -- Parent ASIN if this is a variation
  variation_theme TEXT, -- e.g., "Color", "Size", "Color-Size"
  is_parent BOOLEAN DEFAULT FALSE, -- true if this ASIN has variations
  last_enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (parent_asin) REFERENCES asin_core(asin) ON DELETE SET NULL
);

-- Indexes for fast lookups and TTL-based queries
CREATE INDEX IF NOT EXISTS idx_asin_core_last_enriched ON asin_core(last_enriched_at);
CREATE INDEX IF NOT EXISTS idx_asin_core_brand ON asin_core(brand) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asin_core_product_type ON asin_core(product_type) WHERE product_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asin_market_last_enriched ON asin_market(last_enriched_at);
CREATE INDEX IF NOT EXISTS idx_asin_market_primary_category ON asin_market(primary_category) WHERE primary_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asin_market_primary_rank ON asin_market(primary_rank) WHERE primary_rank IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asin_attributes_last_enriched ON asin_attributes(last_enriched_at);

CREATE INDEX IF NOT EXISTS idx_asin_media_last_enriched ON asin_media(last_enriched_at);

CREATE INDEX IF NOT EXISTS idx_asin_relationships_last_enriched ON asin_relationships(last_enriched_at);
CREATE INDEX IF NOT EXISTS idx_asin_relationships_parent ON asin_relationships(parent_asin) WHERE parent_asin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asin_relationships_is_parent ON asin_relationships(is_parent) WHERE is_parent = TRUE;

-- Enable RLS (Row Level Security)
ALTER TABLE asin_core ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_market ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_relationships ENABLE ROW LEVEL SECURITY;

-- Policies: Allow service role (backend) full access, authenticated users read-only
CREATE POLICY "Service role can manage asin_core"
  ON asin_core FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_core"
  ON asin_core FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage asin_market"
  ON asin_market FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_market"
  ON asin_market FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage asin_attributes"
  ON asin_attributes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_attributes"
  ON asin_attributes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage asin_media"
  ON asin_media FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_media"
  ON asin_media FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage asin_relationships"
  ON asin_relationships FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_relationships"
  ON asin_relationships FOR SELECT
  TO authenticated
  USING (true);

-- Add comments
COMMENT ON TABLE asin_core IS 'Core product identification data from SP-API Catalog Items (title, brand, manufacturer, model, product type). TTL: 7 days.';
COMMENT ON TABLE asin_market IS 'Sales performance data from SP-API Catalog Items (BSR, categories). TTL: 7 days.';
COMMENT ON TABLE asin_attributes IS 'Buyer-facing, comparable attributes from SP-API Catalog Items (bullets, features, dimensions, specs). TTL: 7 days.';
COMMENT ON TABLE asin_media IS 'Product images from SP-API Catalog Items. TTL: 7 days.';
COMMENT ON TABLE asin_relationships IS 'Product relationships from SP-API Catalog Items (parent/child ASINs, variations). TTL: 7 days.';

