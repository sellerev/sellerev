-- Pending Memory Queue
-- Stores memory candidates that require user confirmation before being saved

CREATE TABLE IF NOT EXISTS pending_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  memory_candidate JSONB NOT NULL, -- Full ExtractedMemory object
  reason TEXT NOT NULL CHECK (reason IN ('inferred', 'conflict', 'low_confidence')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Prevent duplicate pending memories for same key
  UNIQUE(user_id, (memory_candidate->>'memory_type'), (memory_candidate->>'key'))
);

-- Indexes
CREATE INDEX idx_pending_memory_user_id ON pending_memory(user_id);
CREATE INDEX idx_pending_memory_created_at ON pending_memory(created_at DESC);

-- RLS Policies
ALTER TABLE pending_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pending memories"
  ON pending_memory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own pending memories"
  ON pending_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pending memories"
  ON pending_memory FOR DELETE
  USING (auth.uid() = user_id);
