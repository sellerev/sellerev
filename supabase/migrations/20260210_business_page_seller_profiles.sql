-- Business page: single source of truth for AI personalization
-- Adds all seller_profiles columns required for Business page sections A–G.
-- Existing columns (stage, sourcing_model, experience_months, primary_goal, timeline_days,
-- constraints, marketplace, margin_target, max_fee_pct, amazon_connected, etc.) may already exist.

-- Section A — Seller Identity
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS marketplaces jsonb NULL,
  ADD COLUMN IF NOT EXISTS business_type text NULL,
  ADD COLUMN IF NOT EXISTS success_definition text NULL,
  ADD COLUMN IF NOT EXISTS current_focus text NULL,
  ADD COLUMN IF NOT EXISTS notes_constraints text NULL;

-- Section D — Unit Economics (some names align with existing; add any missing)
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS target_price_min numeric(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS target_price_max numeric(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS margin_target_pct numeric(5, 2) NULL,
  ADD COLUMN IF NOT EXISTS target_net_profit_per_unit numeric(12, 2) NULL;

-- Section E — Product Research Preferences
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS review_barrier_tolerance text NULL,
  ADD COLUMN IF NOT EXISTS competition_tolerance text NULL,
  ADD COLUMN IF NOT EXISTS ad_spend_tolerance text NULL,
  ADD COLUMN IF NOT EXISTS brand_strategy text NULL;

-- Section F — Operating Reality
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS uses_fba boolean NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ships_from text NULL,
  ADD COLUMN IF NOT EXISTS shipping_mode_preference text NULL,
  ADD COLUMN IF NOT EXISTS lead_time_days int NULL,
  ADD COLUMN IF NOT EXISTS moq_tolerance text NULL;

-- Section G — Amazon (extend existing)
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS amazon_marketplaces_connected jsonb NULL,
  ADD COLUMN IF NOT EXISTS amazon_last_sync_at timestamptz NULL;

-- Optional: seller_context_events for audit/training (append-only)
CREATE TABLE IF NOT EXISTS public.seller_context_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_context_events_user_id ON public.seller_context_events(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_context_events_created_at ON public.seller_context_events(created_at DESC);

ALTER TABLE public.seller_context_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own context events" ON public.seller_context_events;
CREATE POLICY "Users can insert own context events"
  ON public.seller_context_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own context events" ON public.seller_context_events;
CREATE POLICY "Users can read own context events"
  ON public.seller_context_events FOR SELECT
  USING (auth.uid() = user_id);
