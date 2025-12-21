-- Add seller_memory table for AI Copilot persistent memory
-- This stores project-aware context that shapes AI responses over time

CREATE TABLE IF NOT EXISTS seller_memory (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_seller_memory_user_id ON seller_memory(user_id);

-- Enable RLS
ALTER TABLE seller_memory ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own memory
CREATE POLICY "Users can view their own memory"
  ON seller_memory
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own memory"
  ON seller_memory
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memory"
  ON seller_memory
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_seller_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_seller_memory_updated_at
  BEFORE UPDATE ON seller_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_seller_memory_updated_at();
