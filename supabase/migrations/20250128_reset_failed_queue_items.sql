-- Reset failed queue items to pending so they can be reprocessed
-- This is a one-time data fix to recover from the missing process-keyword function

UPDATE keyword_queue
SET status = 'pending'
WHERE status = 'failed';

