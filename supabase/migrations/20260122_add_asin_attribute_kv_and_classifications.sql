-- ASIN Attribute Key-Value and Classifications Tables
-- Flexible storage for SP-API Catalog Items attributes and category hierarchy

-- ASIN Attribute Key-Value - Flexible storage for all attributes
CREATE TABLE IF NOT EXISTS asin_attribute_kv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL,
  marketplace_id TEXT NOT NULL DEFAULT 'ATVPDKIKX0DER',
  attribute_name TEXT NOT NULL,
  attribute_value TEXT, -- Stringified if complex (array/object)
  attribute_type TEXT NOT NULL CHECK (attribute_type IN ('string', 'number', 'boolean', 'array', 'object')),
  source TEXT NOT NULL DEFAULT 'sp_api_catalog',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One attribute per ASIN per marketplace (upsert on attribute_name)
  UNIQUE(asin, marketplace_id, attribute_name)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_asin_attribute_kv_asin ON asin_attribute_kv(asin);
CREATE INDEX IF NOT EXISTS idx_asin_attribute_kv_marketplace ON asin_attribute_kv(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_asin_attribute_kv_name ON asin_attribute_kv(attribute_name);
CREATE INDEX IF NOT EXISTS idx_asin_attribute_kv_source ON asin_attribute_kv(source);
CREATE INDEX IF NOT EXISTS idx_asin_attribute_kv_updated ON asin_attribute_kv(updated_at);

-- ASIN Classifications - Category hierarchy/tree
CREATE TABLE IF NOT EXISTS asin_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL,
  marketplace_id TEXT NOT NULL DEFAULT 'ATVPDKIKX0DER',
  classification_id TEXT NOT NULL,
  classification_name TEXT NOT NULL,
  parent_classification_id TEXT, -- NULL for root level
  hierarchy_level INTEGER NOT NULL DEFAULT 0, -- root=0, increases for nested levels
  source TEXT NOT NULL DEFAULT 'sp_api_catalog',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One classification per ASIN per marketplace per classification_id
  UNIQUE(asin, marketplace_id, classification_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_asin_classifications_asin ON asin_classifications(asin);
CREATE INDEX IF NOT EXISTS idx_asin_classifications_marketplace ON asin_classifications(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_asin_classifications_parent ON asin_classifications(parent_classification_id) WHERE parent_classification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asin_classifications_level ON asin_classifications(hierarchy_level);
CREATE INDEX IF NOT EXISTS idx_asin_classifications_updated ON asin_classifications(updated_at);

-- Update asin_core table to add missing fields (if not already present)
DO $$ 
BEGIN
  -- Add manufacturer if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'asin_core' AND column_name = 'manufacturer') THEN
    ALTER TABLE asin_core ADD COLUMN manufacturer TEXT;
  END IF;

  -- Add model_number if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'asin_core' AND column_name = 'model_number') THEN
    ALTER TABLE asin_core ADD COLUMN model_number TEXT;
  END IF;

  -- Add product_type if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'asin_core' AND column_name = 'product_type') THEN
    ALTER TABLE asin_core ADD COLUMN product_type TEXT;
  END IF;
END $$;

-- Enable RLS (Row Level Security)
ALTER TABLE asin_attribute_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_classifications ENABLE ROW LEVEL SECURITY;

-- Policies: Allow service role (backend) full access, authenticated users read-only
CREATE POLICY "Service role can manage asin_attribute_kv"
  ON asin_attribute_kv FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_attribute_kv"
  ON asin_attribute_kv FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage asin_classifications"
  ON asin_classifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asin_classifications"
  ON asin_classifications FOR SELECT
  TO authenticated
  USING (true);

-- Add comments
COMMENT ON TABLE asin_attribute_kv IS 'Flexible key-value storage for all SP-API Catalog Items attributes. Stores every attribute under the attributes object.';
COMMENT ON TABLE asin_classifications IS 'Category hierarchy/tree from SP-API Catalog Items classifications. Stores the full category path with parent-child relationships.';
COMMENT ON COLUMN asin_attribute_kv.attribute_value IS 'Stored as text. Arrays and objects are JSON stringified.';
COMMENT ON COLUMN asin_classifications.hierarchy_level IS '0 = root category, increments for each nested level';

