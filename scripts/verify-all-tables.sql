-- Quick Verification Script
-- Run this to see which tables exist and their row counts

SELECT 
  t.table_name,
  CASE 
    WHEN t.table_name IS NOT NULL THEN '✓ EXISTS'
    ELSE '✗ MISSING'
  END as status,
  COALESCE(
    (SELECT COUNT(*) 
     FROM information_schema.columns c 
     WHERE c.table_name = t.table_name 
     AND c.table_schema = 'public'), 
    0
  ) as column_count
FROM (
  SELECT unnest(ARRAY[
    'seller_memory',
    'seller_attachments',
    'keyword_analysis_cache',
    'fba_fee_cache',
    'fee_cache',
    'analysis_runs',
    'analysis_messages',
    'seller_profiles'
  ]) as table_name
) t
LEFT JOIN information_schema.tables it
  ON it.table_name = t.table_name
  AND it.table_schema = 'public'
ORDER BY t.table_name;
