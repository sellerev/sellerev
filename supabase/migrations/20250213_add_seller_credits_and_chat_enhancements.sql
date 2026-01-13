-- Seller Credits & Chat Enhancements
-- Purpose: Add source_asins and credits_used to analysis_messages for audit trail

-- ============================================================================
-- ENHANCE ANALYSIS_MESSAGES TABLE
-- ============================================================================
-- Add source_asins and credits_used columns if they don't exist
DO $$ 
BEGIN
  -- Add source_asins column (array of ASINs referenced in the message)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'analysis_messages' AND column_name = 'source_asins'
  ) THEN
    ALTER TABLE analysis_messages 
    ADD COLUMN source_asins TEXT[] DEFAULT NULL;
  END IF;

  -- Add credits_used column (number of credits consumed for this message)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'analysis_messages' AND column_name = 'credits_used'
  ) THEN
    ALTER TABLE analysis_messages 
    ADD COLUMN credits_used INTEGER DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Add index for source_asins queries (if needed)
CREATE INDEX IF NOT EXISTS idx_analysis_messages_source_asins 
  ON analysis_messages USING GIN (source_asins);

-- Add index for credits_used queries
CREATE INDEX IF NOT EXISTS idx_analysis_messages_credits_used 
  ON analysis_messages(credits_used);

-- ============================================================================
-- NOTES
-- ============================================================================
-- The user_credits table already exists from Step 5 migration
-- This migration only enhances analysis_messages for audit trail

