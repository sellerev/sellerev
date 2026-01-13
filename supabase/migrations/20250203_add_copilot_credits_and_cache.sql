-- Copilot Credit System & Product Cache
-- Purpose: Track credits for Copilot escalations and cache product details

-- ============================================================================
-- USER CREDITS TABLE
-- ============================================================================
-- Tracks credit balances per user (free, purchased, subscription, used)
CREATE TABLE IF NOT EXISTS user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  free_credits INTEGER DEFAULT 10 NOT NULL, -- One-time free credits (allocated on account creation)
  purchased_credits INTEGER DEFAULT 0 NOT NULL, -- Credits from packs
  subscription_credits INTEGER DEFAULT 0 NOT NULL, -- Monthly subscription credits (future)
  used_credits INTEGER DEFAULT 0 NOT NULL, -- Total credits used (lifetime)
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_user_credits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_credits_updated_at
  BEFORE UPDATE ON user_credits
  FOR EACH ROW
  EXECUTE FUNCTION update_user_credits_updated_at();

-- ============================================================================
-- CREDIT TRANSACTIONS TABLE
-- ============================================================================
-- Audit log of all credit transactions (allocations, purchases, usage)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('free_allocated', 'purchased', 'used', 'subscription')),
  credits INTEGER NOT NULL, -- Positive for additions, negative for usage
  pack_id TEXT, -- If purchased, which pack (e.g., 'starter', 'professional', 'power_user')
  payment_id TEXT, -- If purchased, Stripe payment ID
  analysis_run_id UUID REFERENCES analysis_runs(id) ON DELETE SET NULL, -- If used, which analysis
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

-- ============================================================================
-- CREDIT USAGE LOG TABLE
-- ============================================================================
-- Detailed log of credit usage per escalation (for session/daily limits)
CREATE TABLE IF NOT EXISTS credit_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  credits_used INTEGER DEFAULT 1 NOT NULL CHECK (credits_used >= 0),
  cached BOOLEAN DEFAULT FALSE NOT NULL, -- True if data was cached (0 credits)
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes for limit queries
CREATE INDEX IF NOT EXISTS idx_credit_usage_log_user_id ON credit_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_log_analysis_run_id ON credit_usage_log(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_log_created_at ON credit_usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_usage_log_user_created_at ON credit_usage_log(user_id, created_at);

-- ============================================================================
-- ASIN PRODUCT CACHE TABLE
-- ============================================================================
-- Cache full type=product API responses to avoid repeat API calls
-- TTL: 7 days (product details change infrequently)
CREATE TABLE IF NOT EXISTS asin_product_cache (
  asin TEXT PRIMARY KEY,
  product_data JSONB NOT NULL, -- Full Rainforest API response
  last_fetched_at TIMESTAMP DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMP NOT NULL, -- TTL: 7 days from last_fetched_at
  source TEXT DEFAULT 'rainforest' NOT NULL
);

-- Index for TTL-based cleanup
CREATE INDEX IF NOT EXISTS idx_asin_product_cache_expires_at ON asin_product_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_asin_product_cache_last_fetched ON asin_product_cache(last_fetched_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- User Credits: Users can read their own credits, service role can write
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credits"
  ON user_credits
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage credits"
  ON user_credits
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Credit Transactions: Users can read their own transactions, service role can write
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
  ON credit_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage transactions"
  ON credit_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Credit Usage Log: Users can read their own usage, service role can write
ALTER TABLE credit_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage"
  ON credit_usage_log
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage usage"
  ON credit_usage_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ASIN Product Cache: Public read (cached data is shared), service role can write
ALTER TABLE asin_product_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cached products"
  ON asin_product_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage cache"
  ON asin_product_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to allocate free credits to new users
CREATE OR REPLACE FUNCTION allocate_free_credits(p_user_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO user_credits (user_id, free_credits)
  VALUES (p_user_id, 10)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Log transaction
  INSERT INTO credit_transactions (user_id, transaction_type, credits)
  VALUES (p_user_id, 'free_allocated', 10)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate available credits
CREATE OR REPLACE FUNCTION get_available_credits(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_available INTEGER;
BEGIN
  SELECT 
    COALESCE(free_credits, 0) + 
    COALESCE(purchased_credits, 0) + 
    COALESCE(subscription_credits, 0) - 
    COALESCE(used_credits, 0)
  INTO v_available
  FROM user_credits
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(v_available, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get session credits used
CREATE OR REPLACE FUNCTION get_session_credits_used(p_user_id UUID, p_analysis_run_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_session_credits INTEGER;
BEGIN
  SELECT COALESCE(SUM(credits_used), 0)
  INTO v_session_credits
  FROM credit_usage_log
  WHERE user_id = p_user_id
    AND analysis_run_id = p_analysis_run_id;
  
  RETURN COALESCE(v_session_credits, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get daily credits used (rolling 24 hours)
CREATE OR REPLACE FUNCTION get_daily_credits_used(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_daily_credits INTEGER;
BEGIN
  SELECT COALESCE(SUM(credits_used), 0)
  INTO v_daily_credits
  FROM credit_usage_log
  WHERE user_id = p_user_id
    AND created_at >= NOW() - INTERVAL '24 hours';
  
  RETURN COALESCE(v_daily_credits, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment used credits (atomic operation)
CREATE OR REPLACE FUNCTION increment_used_credits(p_user_id UUID, p_credits INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE user_credits
  SET used_credits = used_credits + p_credits,
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  -- If user doesn't exist, create with default values
  IF NOT FOUND THEN
    INSERT INTO user_credits (user_id, free_credits, used_credits)
    VALUES (p_user_id, 10, p_credits)
    ON CONFLICT (user_id) DO UPDATE
    SET used_credits = user_credits.used_credits + p_credits,
        updated_at = NOW();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- AUTO-ALLOCATE FREE CREDITS FOR NEW USERS
-- ============================================================================
-- Trigger to automatically allocate 10 free credits when a new user signs up
-- This runs when a new row is inserted into auth.users

CREATE OR REPLACE FUNCTION auto_allocate_free_credits()
RETURNS TRIGGER AS $$
BEGIN
  -- Allocate 10 free credits to new user
  INSERT INTO user_credits (user_id, free_credits, purchased_credits, subscription_credits, used_credits)
  VALUES (NEW.id, 10, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Log free credit allocation transaction
  INSERT INTO credit_transactions (user_id, transaction_type, credits)
  VALUES (NEW.id, 'free_allocated', 10)
  ON CONFLICT DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: This trigger requires access to auth.users table
-- If auth.users is in a different schema, adjust the trigger accordingly
-- For now, we'll allocate credits manually in the application code
-- when user_credits table is first accessed

