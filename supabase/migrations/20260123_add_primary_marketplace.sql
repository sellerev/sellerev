-- Add primary_marketplace_name field to amazon_connections table
-- This stores the primary marketplace name (e.g., "Amazon.com") for UI display

ALTER TABLE amazon_connections
ADD COLUMN IF NOT EXISTS primary_marketplace_name TEXT NULL;

-- Add comment
COMMENT ON COLUMN amazon_connections.primary_marketplace_name IS 'Primary marketplace name (e.g., "Amazon.com", "Amazon.com.mx") for UI display';

