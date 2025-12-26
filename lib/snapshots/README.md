# Keyword Snapshots Architecture

## Overview

Precomputed snapshot system that decouples user searches from API costs. All Rainforest API calls happen in background workers. User searches are pure database reads.

## Architecture

### User Search Flow (Zero API Cost)
1. User searches keyword
2. Query `keyword_snapshots` table
3. Return snapshot + products (pure DB read)
4. If snapshot doesn't exist → queue keyword and return "queued" response

### Background Processing (Controlled API Cost)
1. Worker pulls keywords from `keyword_queue`
2. Processes sequentially with rate limiting
3. **2 credits per keyword** (1 search + 1 batch product)
4. Saves to `keyword_snapshots` and `keyword_products`

## Cost Structure

**Per Keyword Processing:**
- Search call: 1 credit
- Batch product call: 1 credit (all ASINs in one request)
- **Total: 2 credits = $0.0166 per keyword**

**With 200 keywords/day limit:**
- Daily cost: 400 credits = $3.32
- Monthly cost: ~$100

**At scale (50k keywords):**
- Processing spread over time with refresh strategy
- Monthly cost: ~$7,000
- **Cost per user: $0 (reads are free)**

## Database Schema

See `supabase/migrations/20250120_add_keyword_snapshots.sql`

## Running Background Worker

```bash
tsx scripts/run-background-worker.ts
```

Or via cron (runs every 5 minutes):
```bash
*/5 * * * * cd /path/to/Sellerev && tsx scripts/run-background-worker.ts
```

## API Endpoints

### `/api/analyze` (POST)
- **Read-only** - queries snapshots
- Returns 202 if keyword not in snapshot (queued)
- Returns 200 with analysis if snapshot exists

### `/api/keyword/refresh` (POST)
- Manual refresh endpoint
- Enforces per-user quota (10/day)
- Queues with priority 10

## Refresh Strategy

- Priority ≥ 8: Refresh every 3 days
- Priority 5-7: Refresh every 7 days  
- Priority < 5: Refresh every 14 days

Priority calculated from `search_count` in snapshot.

## Cost Safety Guards

- Max 200 new keywords/day (hard limit)
- Exponential backoff on rate limits
- In-flight request deduplication

