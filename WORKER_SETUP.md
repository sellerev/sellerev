# Background Worker Setup Guide

## Quick Start

### Option 1: Run Manually (Development/Testing)

```bash
npm run worker
```

This will start the worker and it will run continuously until you stop it (Ctrl+C).

### Option 2: Run with tsx directly

```bash
npx tsx scripts/run-background-worker.ts
```

### Option 3: Run in Background (Production)

Use a process manager like `pm2` or `forever`:

```bash
# Install pm2 globally
npm install -g pm2

# Start worker
pm2 start scripts/run-background-worker.ts --interpreter tsx --name keyword-worker

# View logs
pm2 logs keyword-worker

# Stop worker
pm2 stop keyword-worker

# Restart worker
pm2 restart keyword-worker
```

### Option 4: Cron Job (Recommended for Production)

The worker is designed to run continuously, but you can also run it as a cron job that checks for pending keywords periodically.

```bash
# Edit crontab
crontab -e

# Add this line (runs every 5 minutes):
*/5 * * * * cd /Users/Shane/Sellerev && /usr/local/bin/tsx scripts/run-background-worker.ts >> /tmp/keyword-worker.log 2>&1

# Or use npm script:
*/5 * * * * cd /Users/Shane/Sellerev && npm run worker >> /tmp/keyword-worker.log 2>&1
```

**Note:** The worker runs in an infinite loop, so if using cron, you'd want to modify it to process a batch and exit, or use a process manager instead.

## Environment Variables Required

Make sure these are set in your environment:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RAINFOREST_API_KEY=your_rainforest_api_key
```

## Verification

1. Queue a keyword via the API (search for a new keyword)
2. Check logs - you should see processing messages
3. Check `keyword_queue` table - status should change from `pending` → `processing` → `completed`
4. Check `keyword_snapshots` table - new snapshot should appear

## Monitoring

The worker logs:
- Daily processing count
- Keywords processed
- API errors
- Cache hits/misses

Check logs in:
- Console output (if running manually)
- PM2 logs (if using pm2)
- Cron log file (if using cron)

