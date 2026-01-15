-- Extend keyword_products to store all fields needed for full product card rendering
-- This enables cached snapshots to render product cards without Rainforest API calls

-- Add new columns for product card rendering
ALTER TABLE public.keyword_products
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS rating DECIMAL(3, 2), -- e.g., 4.5 (0.00 to 5.00)
  ADD COLUMN IF NOT EXISTS review_count INTEGER,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS is_sponsored BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fulfillment TEXT CHECK (fulfillment IN ('FBA', 'FBM', 'AMZ'));

-- Add comment explaining the purpose
COMMENT ON COLUMN public.keyword_products.title IS 'Product title from Rainforest SERP - enables full card rendering from cache';
COMMENT ON COLUMN public.keyword_products.rating IS 'Star rating (0.00-5.00) from Rainforest SERP';
COMMENT ON COLUMN public.keyword_products.review_count IS 'Number of reviews from Rainforest SERP';
COMMENT ON COLUMN public.keyword_products.image_url IS 'Product image URL from Rainforest SERP';
COMMENT ON COLUMN public.keyword_products.brand IS 'Brand name from Rainforest SERP (normalized)';
COMMENT ON COLUMN public.keyword_products.is_sponsored IS 'Whether listing is sponsored (from Rainforest SERP)';
COMMENT ON COLUMN public.keyword_products.fulfillment IS 'Fulfillment method: FBA, FBM, or AMZ (from Rainforest SERP)';

-- Note: These fields are populated from Rainforest search results (type=search) only
-- No additional product API calls are required

