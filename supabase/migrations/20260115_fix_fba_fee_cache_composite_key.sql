-- Fix FBA fee cache to use composite key (asin, price, marketplace)
-- This ensures fees are correctly cached per price point and marketplace

-- Step 1: Add price and marketplace columns if they don't exist
DO $$ 
BEGIN
  -- Add price column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'fba_fee_cache' 
    AND column_name = 'price'
  ) THEN
    ALTER TABLE public.fba_fee_cache ADD COLUMN price NUMERIC(10, 2);
  END IF;

  -- Add marketplace column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'fba_fee_cache' 
    AND column_name = 'marketplace'
  ) THEN
    ALTER TABLE public.fba_fee_cache ADD COLUMN marketplace TEXT NOT NULL DEFAULT 'ATVPDKIKX0DER';
  END IF;
END $$;

-- Step 2: Drop old unique constraint on asin
ALTER TABLE public.fba_fee_cache DROP CONSTRAINT IF EXISTS fba_fee_cache_asin_key;

-- Step 3: Create new composite unique constraint
ALTER TABLE public.fba_fee_cache 
  ADD CONSTRAINT fba_fee_cache_asin_price_marketplace_key 
  UNIQUE (asin, price, marketplace);

-- Step 4: Update index to include price and marketplace for faster lookups
DROP INDEX IF EXISTS idx_fba_fee_cache_asin;
CREATE INDEX IF NOT EXISTS idx_fba_fee_cache_asin_price_marketplace
ON public.fba_fee_cache(asin, price, marketplace);

-- Step 5: Add comment
COMMENT ON COLUMN public.fba_fee_cache.price IS 'Selling price in USD - fees vary by price';
COMMENT ON COLUMN public.fba_fee_cache.marketplace IS 'Marketplace ID (e.g., ATVPDKIKX0DER for US) - fees vary by marketplace';
COMMENT ON TABLE public.fba_fee_cache IS 'Caches detailed FBA fee breakdowns (fulfillment + referral) from SP-API. Composite key: (asin, price, marketplace).';

