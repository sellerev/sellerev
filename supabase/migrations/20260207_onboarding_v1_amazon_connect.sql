-- Onboarding v1: amazon_connected on seller_profiles, marketplace, goals/timeline/constraints, onboarding responses

-- seller_profiles: connection status (derived from amazon_connections can stay; we mirror for quick reads)
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS amazon_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS amazon_connected_at timestamptz NULL;

COMMENT ON COLUMN public.seller_profiles.amazon_connected IS 'True when user has completed Amazon OAuth; used for Data used / accuracy messaging';
COMMENT ON COLUMN public.seller_profiles.amazon_connected_at IS 'When Amazon was connected (for analytics)';

-- seller_profiles: marketplace (Step 1) and goal/timeline/constraints (Step 2)
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS marketplace text NULL,
  ADD COLUMN IF NOT EXISTS primary_goal text NULL,
  ADD COLUMN IF NOT EXISTS timeline_days int NULL,
  ADD COLUMN IF NOT EXISTS constraints jsonb NULL;

-- Optional check for marketplace
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seller_profiles_marketplace_check'
  ) THEN
    ALTER TABLE public.seller_profiles
      ADD CONSTRAINT seller_profiles_marketplace_check
      CHECK (marketplace IS NULL OR marketplace IN ('US', 'CA', 'Both', 'Other'));
  END IF;
END $$;

-- seller_onboarding_responses: store full onboarding payload (version, step1/2/3/4)
CREATE TABLE IF NOT EXISTS public.seller_onboarding_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_onboarding_responses_user_id
  ON public.seller_onboarding_responses(user_id);

ALTER TABLE public.seller_onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own onboarding response"
  ON public.seller_onboarding_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding response"
  ON public.seller_onboarding_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding response"
  ON public.seller_onboarding_responses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Backfill amazon_connected from existing amazon_connections
UPDATE public.seller_profiles p
SET amazon_connected = true,
    amazon_connected_at = (SELECT created_at FROM public.amazon_connections c WHERE c.user_id = p.id AND c.status = 'connected' LIMIT 1)
WHERE EXISTS (
  SELECT 1 FROM public.amazon_connections c
  WHERE c.user_id = p.id AND c.status = 'connected'
);
