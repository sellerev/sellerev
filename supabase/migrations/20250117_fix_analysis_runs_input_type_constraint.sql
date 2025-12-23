-- Fix analysis_runs input_type constraint to allow both 'asin' and 'keyword'
-- 
-- Step 1: Drop the existing constraint if it exists
ALTER TABLE analysis_runs 
DROP CONSTRAINT IF EXISTS analysis_runs_input_type_check;

-- Step 2: Check what values exist (for debugging - you can run this separately)
-- SELECT DISTINCT input_type FROM analysis_runs;

-- Step 3: Update any existing rows with invalid input_type values
-- Set NULL or invalid values to 'keyword' as default
UPDATE analysis_runs 
SET input_type = 'keyword' 
WHERE input_type IS NULL 
   OR (input_type NOT IN ('asin', 'keyword'));

-- Step 4: Add new constraint that allows both 'asin' and 'keyword'
ALTER TABLE analysis_runs 
ADD CONSTRAINT analysis_runs_input_type_check 
CHECK (input_type IN ('asin', 'keyword'));
