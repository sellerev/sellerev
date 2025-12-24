-- Verify Memory System Tables
-- Run this in Supabase SQL Editor to check table structures

-- 1. Check seller_memory table structure
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'seller_memory'
ORDER BY ordinal_position;

-- 2. Check pending_memory table structure
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pending_memory'
ORDER BY ordinal_position;

-- 3. Verify seller_memory has all required columns
SELECT 
  CASE 
    WHEN COUNT(*) = 12 THEN '✓ All 12 columns present'
    ELSE '✗ Missing columns. Expected 12, found: ' || COUNT(*)::text
  END as status,
  string_agg(column_name, ', ' ORDER BY column_name) as columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'seller_memory'
  AND column_name IN (
    'id', 'user_id', 'memory_type', 'key', 'value',
    'confidence', 'source', 'source_reference',
    'is_user_editable', 'last_confirmed_at',
    'created_at', 'updated_at'
  );

-- 4. Verify pending_memory has all required columns
SELECT 
  CASE 
    WHEN COUNT(*) = 5 THEN '✓ All 5 columns present'
    ELSE '✗ Missing columns. Expected 5, found: ' || COUNT(*)::text
  END as status,
  string_agg(column_name, ', ' ORDER BY column_name) as columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pending_memory'
  AND column_name IN (
    'id', 'user_id', 'memory_candidate', 'reason', 'created_at'
  );

-- 5. Check unique index on pending_memory
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'pending_memory'
  AND indexname = 'idx_pending_memory_unique_key';

-- 6. Check RLS policies on seller_memory
SELECT 
  policyname,
  cmd as command,
  CASE WHEN qual IS NOT NULL THEN '✓' ELSE '✗' END as has_using,
  CASE WHEN with_check IS NOT NULL THEN '✓' ELSE '✗' END as has_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'seller_memory';

-- 7. Check RLS policies on pending_memory
SELECT 
  policyname,
  cmd as command,
  CASE WHEN qual IS NOT NULL THEN '✓' ELSE '✗' END as has_using,
  CASE WHEN with_check IS NOT NULL THEN '✓' ELSE '✗' END as has_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pending_memory';

-- 8. Check triggers on seller_memory
SELECT 
  trigger_name,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'seller_memory';
