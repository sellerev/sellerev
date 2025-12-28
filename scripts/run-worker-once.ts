/**
 * ⚠️ DEPRECATED: This script is no longer needed.
 * 
 * The worker now runs automatically via Supabase CRON every 2 minutes.
 * See WORKER_CRON_SETUP.md for details.
 * 
 * This script is kept for manual testing/debugging only.
 * 
 * Usage (for testing only):
 *   tsx scripts/run-worker-once.ts
 */

import {
  getPendingQueueItems,
  markQueueProcessing,
  markQueueCompleted,
  markQueueFailed,
  saveKeywordSnapshot,
  getDailyProcessingCount,
} from '../lib/snapshots/keywordSnapshots';
import { processKeyword } from '../lib/snapshots/keywordProcessor';
import { createClient } from '@supabase/supabase-js';

const MAX_KEYWORDS_PER_DAY = 200;
const BATCH_SIZE = 10;
const KEYWORD_PROCESSING_DELAY_MS = 2000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processBatch() {
  try {
    // Check daily limit
    const processedToday = await getDailyProcessingCount(supabase);
    const remaining = MAX_KEYWORDS_PER_DAY - processedToday;

    if (remaining <= 0) {
      console.log('Daily keyword limit reached', {
        processedToday,
        maxDaily: MAX_KEYWORDS_PER_DAY,
      });
      return;
    }

    // Get pending items
    const pendingItems = await getPendingQueueItems(supabase, Math.min(BATCH_SIZE, remaining));

    if (pendingItems.length === 0) {
      console.log('No pending keywords');
      return;
    }

    console.log(`Processing ${pendingItems.length} keywords...`, {
      remainingDaily: remaining,
    });

    // Process sequentially
    for (const item of pendingItems) {
      try {
        // Mark as processing
        const claimed = await markQueueProcessing(supabase, item.id);
        if (!claimed) {
          console.log('Skipping item, already being processed', { id: item.id });
          continue;
        }

        console.log('Processing keyword', {
          id: item.id,
          keyword: item.keyword,
          priority: item.priority,
        });

        // Process keyword
        const result = await processKeyword(supabase, item.keyword, item.marketplace);

        if (result.success && result.snapshot && result.products) {
          // Save snapshot and products
          const saved = await saveKeywordSnapshot(
            supabase,
            result.snapshot,
            result.products
          );

          if (saved) {
            await markQueueCompleted(supabase, item.id);
            console.log('Keyword processed successfully', {
              id: item.id,
              keyword: item.keyword,
              productCount: result.products.length,
            });
          } else {
            await markQueueFailed(supabase, item.id, 'Failed to save snapshot');
            console.error('Failed to save snapshot', { id: item.id, keyword: item.keyword });
          }
        } else {
          await markQueueFailed(supabase, item.id, result.error || 'Unknown error');
          console.error('Keyword processing failed', {
            id: item.id,
            keyword: item.keyword,
            error: result.error,
          });
        }

        // Small delay between keywords
        await sleep(KEYWORD_PROCESSING_DELAY_MS);

      } catch (error) {
        console.error('Error processing keyword', {
          id: item.id,
          keyword: item.keyword,
          error: error instanceof Error ? error.message : String(error),
        });

        await markQueueFailed(
          supabase,
          item.id,
          error instanceof Error ? error.message : 'Processing exception'
        );
      }
    }

  } catch (error) {
    console.error('Batch processing error:', error);
    process.exit(1);
  }
}

// Run once and exit
processBatch()
  .then(() => {
    console.log('Batch processing complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

