-- Supabase CRON job to run keyword-worker every 2 minutes
-- This makes the worker fully automatic with zero manual intervention

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule keyword-worker to run every 2 minutes
-- Calls the Supabase Edge Function via HTTP
SELECT cron.schedule(
  'keyword-worker-every-2min',
  '*/2 * * * *', -- Every 2 minutes
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/keyword-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      )::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Note: You'll need to set these settings in Supabase:
-- app.settings.supabase_url = 'https://your-project.supabase.co'
-- app.settings.service_role_key = 'your-service-role-key'

-- Alternative: Use Supabase Dashboard to create the CRON job
-- Go to Database > Cron Jobs > New Job
-- Schedule: */2 * * * *
-- SQL: SELECT net.http_post(...) as above

