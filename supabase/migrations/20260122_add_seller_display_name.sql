-- Add seller_display_name field to amazon_connections table
-- This stores the Amazon seller account display name for UI purposes

ALTER TABLE amazon_connections
ADD COLUMN IF NOT EXISTS seller_display_name TEXT NULL;

-- Add comment
COMMENT ON COLUMN amazon_connections.seller_display_name IS 'Amazon seller account display name (storefront/brand name) for UI display';

