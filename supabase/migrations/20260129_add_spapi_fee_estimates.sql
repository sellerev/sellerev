-- spapi_fee_estimates: cache for SP-API fees estimate (asin + marketplace + price)
-- TTL 7 days. Used by /api/fees-estimate and chat Fees & Profit card.

CREATE TABLE IF NOT EXISTS public.spapi_fee_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin text NOT NULL,
  marketplace_id text NOT NULL,
  price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  total_fees numeric,
  fee_lines jsonb NOT NULL DEFAULT '[]',
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (asin, marketplace_id, price)
);

CREATE INDEX IF NOT EXISTS idx_spapi_fee_estimates_expires_at
  ON public.spapi_fee_estimates (expires_at);

COMMENT ON TABLE public.spapi_fee_estimates IS 'Caches SP-API fees estimate per (asin, marketplace_id, price). 7-day TTL.';

ALTER TABLE public.spapi_fee_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage spapi_fee_estimates"
  ON public.spapi_fee_estimates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read spapi_fee_estimates"
  ON public.spapi_fee_estimates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert and update spapi_fee_estimates"
  ON public.spapi_fee_estimates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
