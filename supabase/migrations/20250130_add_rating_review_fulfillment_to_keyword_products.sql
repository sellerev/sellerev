-- Add missing fields to keyword_products table for ASIN cache
-- These fields are needed to store canonical product data after analysis

ALTER TABLE keyword_products
ADD COLUMN IF NOT EXISTS rating NUMERIC,
ADD COLUMN IF NOT EXISTS review_count INTEGER,
ADD COLUMN IF NOT EXISTS fulfillment TEXT;

