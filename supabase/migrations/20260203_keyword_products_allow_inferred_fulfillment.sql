-- Allow fulfillment_source = 'inferred' in keyword_products
-- Fixes: "new row for relation keyword_products violates check constraint keyword_products_fulfillment_source_check"
-- when data comes from keyword_snapshots (e.g. "food warming mat") and fulfillment is inferred, not from SERP/SP-API.

ALTER TABLE public.keyword_products
  DROP CONSTRAINT IF EXISTS keyword_products_fulfillment_source_check;

ALTER TABLE public.keyword_products
  ADD CONSTRAINT keyword_products_fulfillment_source_check
  CHECK (fulfillment_source IS NULL OR fulfillment_source IN ('sp_api_pricing', 'rainforest_serp', 'inferred'));

COMMENT ON COLUMN public.keyword_products.fulfillment_source IS 'Source of fulfillment channel: sp_api_pricing (authoritative), rainforest_serp (SERP hint), inferred (from snapshot/canonical builder)';
