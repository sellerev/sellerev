-- Amazon SP-API OAuth Connections
-- Stores encrypted refresh tokens for per-user SP-API access

CREATE TABLE IF NOT EXISTS amazon_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id TEXT NULL, -- If available from profile endpoint later; ok if null for v1
  marketplace_ids TEXT[] NULL, -- Optional marketplace IDs
  refresh_token_encrypted TEXT NOT NULL,
  refresh_token_last4 TEXT NOT NULL, -- Last 4 chars for UI display
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL,
  UNIQUE(user_id) -- One connection per user
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_amazon_connections_user_id ON amazon_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_amazon_connections_status ON amazon_connections(status);

-- Enable RLS
ALTER TABLE amazon_connections ENABLE ROW LEVEL SECURITY;

-- Policy: Users can select their own row
CREATE POLICY "Allow users to read own connection"
  ON amazon_connections
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can update status/revoked_at for their own row
CREATE POLICY "Allow users to update own connection status"
  ON amazon_connections
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can insert/update (for token storage via RPC)
-- We'll use an RPC function with SECURITY DEFINER for token storage
CREATE POLICY "Allow service role to manage connections"
  ON amazon_connections
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_amazon_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_amazon_connections_updated_at
  BEFORE UPDATE ON amazon_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_amazon_connections_updated_at();

