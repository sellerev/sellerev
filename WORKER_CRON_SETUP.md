# Supabase CRON Setup for Keyword Worker

## Automatic Worker Execution

The keyword-worker runs automatically every 2 minutes via Supabase CRON.

## Setup Instructions

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard
2. Navigate to **Database** → **Cron Jobs**
3. Click **New Cron Job**
4. Configure:
   - **Name**: `keyword-worker-every-2min`
   - **Schedule**: `*/2 * * * *` (every 2 minutes)
   - **SQL**:
   ```sql
   SELECT
     net.http_post(
       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/keyword-worker',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
       )::jsonb,
       body := '{}'::jsonb
     ) AS request_id;
   ```
5. Replace:
   - `YOUR_PROJECT_REF` with your Supabase project reference ID
   - `YOUR_SERVICE_ROLE_KEY` with your service role key
6. Click **Save**

### Option 2: SQL Migration

Run the migration file:
```bash
npx supabase db push
```

Then manually set the environment variables in Supabase Dashboard:
- Settings → Database → Custom Postgres Config
- Add: `app.settings.supabase_url`
- Add: `app.settings.service_role_key`

## Verification

After setup, check:
1. **Cron Jobs** tab shows the job is active
2. **Edge Functions** logs show worker runs every 2 minutes
3. **keyword_queue** table shows items being processed
4. **keyword_snapshots** table gets populated

## How It Works

1. CRON triggers every 2 minutes
2. Calls `keyword-worker` Edge Function via HTTP
3. Worker processes up to 10 pending queue items
4. Each item gets Tier-2 enrichment (Rainforest API)
5. Snapshots are updated with real data
6. Queue items marked as completed

## Cost Control

- User searches: $0 (Tier-1 snapshots, no API calls)
- Background enrichment: ~2 credits per keyword (search + product)
- Worker runs: Free (Supabase CRON included)
- Queue processing: Automatic, no manual intervention

