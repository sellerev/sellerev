-- Add source tagging fields to keyword_products table
-- These fields track where metadata came from (for debugging and UI badges)

ALTER TABLE public.keyword_products
  ADD COLUMN IF NOT EXISTS brand_source TEXT CHECK (brand_source IN ('sp_api', 'rainforest', 'inferred')),
  ADD COLUMN IF NOT EXISTS title_source TEXT CHECK (title_source IN ('sp_api', 'rainforest')),
  ADD COLUMN IF NOT EXISTS category_source TEXT CHECK (category_source IN ('sp_api'));

-- Add comments explaining the purpose
COMMENT ON COLUMN public.keyword_products.brand_source IS 'Source of brand data: sp_api (authoritative), rainforest (SERP hint), inferred (from title)';
COMMENT ON COLUMN public.keyword_products.title_source IS 'Source of title data: sp_api (authoritative), rainforest (SERP hint)';
COMMENT ON COLUMN public.keyword_products.category_source IS 'Source of category data: sp_api (authoritative, no fallback)';

