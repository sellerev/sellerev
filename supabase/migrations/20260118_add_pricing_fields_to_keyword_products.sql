-- Add SP-API Pricing API fields to keyword_products table
-- These fields store buy box owner, offer count, and authoritative fulfillment channel

ALTER TABLE public.keyword_products
  ADD COLUMN IF NOT EXISTS buy_box_owner TEXT CHECK (buy_box_owner IN ('Amazon', 'Merchant', 'Unknown')),
  ADD COLUMN IF NOT EXISTS offer_count INTEGER;

-- Add comments explaining the purpose
COMMENT ON COLUMN public.keyword_products.buy_box_owner IS 'Buy Box owner from SP-API Pricing API: Amazon, Merchant, or Unknown';
COMMENT ON COLUMN public.keyword_products.offer_count IS 'Total offer count from SP-API Pricing API (number of sellers competing)';

