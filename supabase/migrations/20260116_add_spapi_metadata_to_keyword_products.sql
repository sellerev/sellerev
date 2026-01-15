-- Add SP-API metadata fields to keyword_products table
-- These fields enable full product card rendering from cached snapshots
-- Metadata TTL: 7 days (last_enriched_at)

ALTER TABLE public.keyword_products
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS bsr INTEGER,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Add comments explaining the purpose
COMMENT ON COLUMN public.keyword_products.title IS 'Product title from SP-API Catalog Items - enables full card rendering from cache';
COMMENT ON COLUMN public.keyword_products.brand IS 'Brand name from SP-API Catalog Items (normalized)';
COMMENT ON COLUMN public.keyword_products.image_url IS 'Primary product image URL from SP-API Catalog Items';
COMMENT ON COLUMN public.keyword_products.category IS 'Product category from SP-API Catalog Items';
COMMENT ON COLUMN public.keyword_products.bsr IS 'Best Seller Rank from SP-API Catalog Items (if available)';
COMMENT ON COLUMN public.keyword_products.last_enriched_at IS 'Timestamp when metadata was last enriched via SP-API (7-day TTL)';

-- Create index for efficient cache lookups
CREATE INDEX IF NOT EXISTS idx_keyword_products_last_enriched_at 
  ON public.keyword_products(last_enriched_at) 
  WHERE last_enriched_at IS NOT NULL;

