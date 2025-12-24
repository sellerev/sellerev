-- Seller Memory System
-- Stores factual, structured information about sellers that persists across sessions

-- Drop existing table if it exists (to fix any previous migration issues)
DROP TABLE IF EXISTS seller_attachments CASCADE;
DROP TABLE IF EXISTS seller_memory CASCADE;

-- Primary memory table
CREATE TABLE seller_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'sourcing',
    'costs',
    'pricing',
    'logistics',
    'constraints',
    'preferences',
    'goals',
    'experience',
    'assets',
    'strategy'
  )),
  
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  source TEXT NOT NULL CHECK (source IN (
    'onboarding',
    'explicit_user_statement',
    'attachment_extraction',
    'ai_inference'
  )),
  
  source_reference UUID NULL,
  is_user_editable BOOLEAN NOT NULL DEFAULT true,
  last_confirmed_at TIMESTAMPTZ NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one memory per seller per key
  UNIQUE(user_id, key)
);

-- Indexes for performance
CREATE INDEX idx_seller_memory_user_id ON seller_memory(user_id);
CREATE INDEX idx_seller_memory_type ON seller_memory(memory_type);
CREATE INDEX idx_seller_memory_key ON seller_memory(key);
CREATE INDEX idx_seller_memory_updated_at ON seller_memory(updated_at DESC);

-- RLS Policies
ALTER TABLE seller_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own memory"
  ON seller_memory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memory"
  ON seller_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memory"
  ON seller_memory FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own memory"
  ON seller_memory FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_seller_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_seller_memory_updated_at
  BEFORE UPDATE ON seller_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_seller_memory_updated_at();

-- Seller Attachments table (for future use)
CREATE TABLE seller_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'csv', 'image', 'text')),
  file_url TEXT NOT NULL,
  parsed BOOLEAN NOT NULL DEFAULT false,
  extracted_memory_count INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_seller_attachments_user_id ON seller_attachments(user_id);

-- RLS Policies
ALTER TABLE seller_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own attachments"
  ON seller_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own attachments"
  ON seller_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own attachments"
  ON seller_attachments FOR DELETE
  USING (auth.uid() = user_id);
