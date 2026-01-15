-- Add missing source tagging fields to keyword_products table
-- These fields track where metadata came from (for debugging and verification)

-- First, update existing brand_source constraint to match new values
ALTER TABLE public.keyword_products
  DROP CONSTRAINT IF EXISTS keyword_products_brand_source_check;

ALTER TABLE public.keyword_products
  ADD CONSTRAINT keyword_products_brand_source_check 
  CHECK (brand_source IN ('sp_api_catalog', 'model_inferred'));

-- Update existing title_source constraint to include model_inferred
ALTER TABLE public.keyword_products
  DROP CONSTRAINT IF EXISTS keyword_products_title_source_check;

ALTER TABLE public.keyword_products
  ADD CONSTRAINT keyword_products_title_source_check 
  CHECK (title_source IN ('sp_api_catalog', 'rainforest_serp', 'model_inferred'));

-- Update existing category_source constraint (keep same but ensure it's correct)
ALTER TABLE public.keyword_products
  DROP CONSTRAINT IF EXISTS keyword_products_category_source_check;

ALTER TABLE public.keyword_products
  ADD CONSTRAINT keyword_products_category_source_check 
  CHECK (category_source IN ('sp_api_catalog'));

-- Add missing source tag columns
ALTER TABLE public.keyword_products
  ADD COLUMN IF NOT EXISTS bsr_source TEXT CHECK (bsr_source IN ('sp_api_catalog')),
  ADD COLUMN IF NOT EXISTS buy_box_owner_source TEXT CHECK (buy_box_owner_source IN ('sp_api_pricing')),
  ADD COLUMN IF NOT EXISTS offer_count_source TEXT CHECK (offer_count_source IN ('sp_api_pricing')),
  ADD COLUMN IF NOT EXISTS fulfillment_source TEXT CHECK (fulfillment_source IN ('sp_api_pricing', 'rainforest_serp')),
  ADD COLUMN IF NOT EXISTS price_source TEXT CHECK (price_source IN ('sp_api_pricing', 'rainforest_serp')),
  ADD COLUMN IF NOT EXISTS image_source TEXT CHECK (image_source IN ('sp_api_catalog', 'rainforest_serp'));

-- Add comments explaining the purpose
COMMENT ON COLUMN public.keyword_products.brand_source IS 'Source of brand data: sp_api_catalog (authoritative), model_inferred (from title)';
COMMENT ON COLUMN public.keyword_products.title_source IS 'Source of title data: sp_api_catalog (authoritative), rainforest_serp (SERP hint), model_inferred (from canonical builder)';
COMMENT ON COLUMN public.keyword_products.category_source IS 'Source of category data: sp_api_catalog (authoritative, no fallback)';
COMMENT ON COLUMN public.keyword_products.bsr_source IS 'Source of BSR data: sp_api_catalog (authoritative, no fallback)';
COMMENT ON COLUMN public.keyword_products.buy_box_owner_source IS 'Source of buy box owner data: sp_api_pricing (authoritative, no fallback)';
COMMENT ON COLUMN public.keyword_products.offer_count_source IS 'Source of offer count data: sp_api_pricing (authoritative, no fallback)';
COMMENT ON COLUMN public.keyword_products.fulfillment_source IS 'Source of fulfillment channel: sp_api_pricing (authoritative), rainforest_serp (SERP hint)';
COMMENT ON COLUMN public.keyword_products.price_source IS 'Source of price data: sp_api_pricing (authoritative), rainforest_serp (SERP hint)';
COMMENT ON COLUMN public.keyword_products.image_source IS 'Source of image URL: sp_api_catalog (authoritative), rainforest_serp (SERP hint)';

